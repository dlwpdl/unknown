"""Free hosted or local release commands; credentials never enter the repository."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import subprocess
import tempfile
import time
import zipfile
import urllib.error
import urllib.parse
import urllib.request

APP = "6809273242"
PACKAGE = "com.dlwpdl.gling"
TEAM = "P3X3452TDZ"
OUT = Path(".release")


def release_version(tag, app, package):
    if not isinstance(tag, str) or not re.fullmatch(r"v\d+\.\d+\.\d+", tag) or tag[1:] != app or app != package:
        raise ValueError("Release tag, app.json and package.json versions must match.")
    return app


def next_build_number(apple_next, android_codes, configured):
    return max(int(apple_next) - 1, int(configured), *(int(x) for x in android_codes)) + 1


def run(args, capture=False, env=None):
    result = subprocess.run(args, env=env, text=True, capture_output=capture)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed; submission stopped. Check the preceding build output.")
    return result.stdout if capture else None


def request(url, token=None, data=None, method="GET", content_type="application/json"):
    headers = {"Content-Type": content_type}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if data is not None and not isinstance(data, bytes):
        data = json.dumps(data).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers, method=method), timeout=180) as response:
            return json.load(response) if response.status != 204 else {}
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Store API returned HTTP {error.code}; check release permissions and current store state.") from None


def secret(name, local_file, local):
    if os.environ.get(name):
        return json.loads(os.environ[name])
    if local:
        return json.loads(local_file.read_text())
    raise ValueError(f"Required GitHub secret {name} is missing.")


def mask(value):
    if os.environ.get("GITHUB_ACTIONS"):
        print("::add-mask::" + str(value).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A"), flush=True)


def setup(directory, local):
    env = os.environ.copy()
    credentials = Path.home() / "Library/Application Support/gling/credentials"
    auth = secret("GLING_ASC_JSON", credentials / "appstore-connect-api.json", local)
    key = directory / f'AuthKey_{auth["keyId"]}.p8'
    key.write_text(auth.get("privateKey") or Path(auth["privateKeyPath"]).expanduser().read_text())
    key.chmod(0o600)
    mask(key.read_text())
    env.update(ASC_KEY_ID=auth["keyId"], ASC_ISSUER_ID=auth["issuerId"], ASC_PRIVATE_KEY_PATH=str(key), ASC_BYPASS_KEYCHAIN="true", ASC_STRICT_AUTH="true")
    google = secret("GLING_PLAY_JSON", credentials / "google-play-service-account.json", local)
    mask(google["private_key"])
    if "GLING_PUBLIC_ENV_JSON" in env:
        public = json.loads(env["GLING_PUBLIC_ENV_JSON"])
        if any(not k.startswith("EXPO_PUBLIC_") or not isinstance(v, str) or "sb_secret_" in v for k, v in public.items()):
            raise ValueError("Only public client configuration may enter the app build.")
        client_key = public.get("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
        if client_key.startswith("eyJ"):
            payload = json.loads(base64.urlsafe_b64decode(client_key.split(".")[1] + "=="))
            if payload.get("role") != "anon":
                raise ValueError("Supabase privileged keys may never enter the client build.")
        if public.get("EXPO_PUBLIC_SUPABASE_URL") != "https://wjvahbdwmctzpkndqaxa.supabase.co":
            raise ValueError("Release configuration must use the existing production project.")
        env.update(public)
    elif not local:
        raise ValueError("GLING_PUBLIC_ENV_JSON is missing; production build stopped.")
    return env, google


def google_token(google, directory):
    encode = lambda value: base64.urlsafe_b64encode(value).rstrip(b"=")
    now = int(time.time())
    payload = {"iss": google["client_email"], "scope": "https://www.googleapis.com/auth/androidpublisher", "aud": "https://oauth2.googleapis.com/token", "iat": now, "exp": now + 3600}
    unsigned = encode(b'{"alg":"RS256","typ":"JWT"}') + b"." + encode(json.dumps(payload).encode())
    key = directory / "google.pem"
    key.write_text(google["private_key"])
    key.chmod(0o600)
    signed = subprocess.run(["openssl", "dgst", "-sha256", "-sign", str(key)], input=unsigned, capture_output=True)
    if signed.returncode:
        raise RuntimeError("Google service account signing failed.")
    assertion = (unsigned + b"." + encode(signed.stdout)).decode()
    form = urllib.parse.urlencode({"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion}).encode()
    token = request("https://oauth2.googleapis.com/token", data=form, method="POST", content_type="application/x-www-form-urlencoded")["access_token"]
    mask(token)
    return token


def play(token, path="", data=None, method="GET"):
    return request(f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PACKAGE}{path}", token, data, method)


def prepare(env, google, directory, tag):
    app = json.loads(Path("app.json").read_text())
    version = release_version(tag, app["expo"]["version"], json.loads(Path("package.json").read_text())["version"])
    if not Path(f"release-notes/{version}.ko.txt").read_text().strip():
        raise ValueError("Release notes must be committed before a release build.")
    apple = json.loads(run(["asc", "builds", "next-build-number", "--app", APP, "--output", "json"], True, env))
    token = google_token(google, directory)
    edit = play(token, "/edits", {}, "POST")["id"]
    try:
        tracks = play(token, f"/edits/{edit}/tracks").get("tracks", [])
        codes = [code for track in tracks for release in track.get("releases", []) for code in release.get("versionCodes", [])]
    finally:
        play(token, f"/edits/{edit}", method="DELETE")
    number = next_build_number(apple["nextBuildNumber"], codes, max(int(app["expo"]["ios"]["buildNumber"]), app["expo"]["android"]["versionCode"]))
    OUT.mkdir(exist_ok=True)
    state = {"version": version, "build": number}
    (OUT / "state.json").write_text(json.dumps(state))
    if "GITHUB_OUTPUT" in env:
        with open(env["GITHUB_OUTPUT"], "a") as output:
            output.write(f"build={number}\nversion={version}\n")
    print(f"Prepared {version} ({number}); both stores checked.")


def signing(directory, local):
    if local:
        source = json.loads(Path("credentials.json").read_text())
        ios, android = source["ios"], source["android"]["keystore"]
        android["keystorePath"] = str(Path(android["keystorePath"]).expanduser().resolve())
        return str(Path(ios["distributionCertificate"]["path"]).expanduser().resolve()), ios["distributionCertificate"]["password"], str(Path(ios["provisioningProfilePath"]).expanduser().resolve()), android
    source = json.loads(os.environ["GLING_SIGNING_JSON"])
    for value in [source["ios"]["password"], source["android"]["keystorePassword"], source["android"]["keyPassword"]]:
        mask(value)
    for name, encoded in [("certificate.p12", source["ios"]["certificate"]), ("profile.mobileprovision", source["ios"]["profile"]), ("upload.p12", source["android"]["keystore"])]:
        file = directory / name
        file.write_bytes(base64.b64decode(encoded, validate=True))
        file.chmod(0o600)
    android = {**source["android"], "keystorePath": str(directory / "upload.p12")}
    return str(directory / "certificate.p12"), source["ios"]["password"], str(directory / "profile.mobileprovision"), android


def build(platform, env, directory, local, number):
    app = json.loads(Path("app.json").read_text())
    app["expo"]["ios"]["buildNumber"] = str(number)
    app["expo"]["android"]["versionCode"] = int(number)
    Path("app.json").write_text(json.dumps(app, ensure_ascii=False, indent=2) + "\n")
    OUT.mkdir(exist_ok=True)
    run(["npx", "expo", "prebuild", "--platform", platform, "--clean", "--no-install"], env=env)
    certificate, password, profile_path, android = signing(directory, local)
    if platform == "android":
        env.update(GLING_UPLOAD_KEYSTORE=android["keystorePath"], GLING_UPLOAD_STORE_PASSWORD=android["keystorePassword"], GLING_UPLOAD_KEY_ALIAS=android["keyAlias"], GLING_UPLOAD_KEY_PASSWORD=android["keyPassword"])
        run(["android/gradlew", "-p", "android", "--no-daemon", "--init-script", str(Path("scripts/android-signing.init.gradle").resolve()), "bundleRelease", "assembleRelease"], env=env)
        artifact = OUT / "app.aab"
        artifact.write_bytes(Path("android/app/build/outputs/bundle/release/app-release.aab").read_bytes())
        run(["jarsigner", "-verify", str(artifact)])
        sdk = Path(env.get("ANDROID_HOME") or env.get("ANDROID_SDK_ROOT") or str(Path.home() / "Library/Android/sdk"))
        tools = sdk / "build-tools/36.0.0"
        apk = Path("android/app/build/outputs/apk/release/app-release.apk")
        manifest = run([str(tools / "aapt"), "dump", "badging", str(apk)], True)
        if not re.search(rf"package: name='{re.escape(PACKAGE)}' versionCode='{number}' versionName='{re.escape(app['expo']['version'])}'", manifest):
            raise ValueError("Android application ID or version does not match the release.")
        verified = run([str(tools / "apksigner"), "verify", "--print-certs", str(apk)], True)
        if "413e75957cf604fd225a37527cce90b7379f3226b572f2b589c77396dcbfefbd" not in verified:
            raise ValueError("Android upload signing identity has changed; submission stopped.")
        run([str(tools / "zipalign"), "-c", "-P", "16", "4", str(apk)])
    else:
        run(["npx", "pod-install", "ios"], env=env)
        profile = plistlib.loads(run(["security", "cms", "-D", "-i", profile_path], True).encode())
        if profile["TeamIdentifier"] != [TEAM] or profile["Entitlements"].get("get-task-allow") or profile["Entitlements"].get("application-identifier") != f"{TEAM}.{PACKAGE}":
            raise ValueError("An App Store distribution profile for the existing team is required.")
        installed = Path.home() / "Library/Developer/Xcode/UserData/Provisioning Profiles" / f'{profile["UUID"]}.mobileprovision'
        installed.parent.mkdir(parents=True, exist_ok=True)
        installed.write_bytes(Path(profile_path).read_bytes())
        keychain, key_password = str(directory / "release.keychain-db"), secrets.token_hex(24)
        mask(key_password)
        prior = re.findall(r'"([^"]+)"', run(["security", "list-keychains", "-d", "user"], True))
        try:
            run(["security", "create-keychain", "-p", key_password, keychain])
            run(["security", "set-keychain-settings", "-lut", "21600", keychain])
            run(["security", "unlock-keychain", "-p", key_password, keychain])
            run(["security", "import", certificate, "-P", password, "-A", "-t", "cert", "-f", "pkcs12", "-k", keychain])
            run(["security", "set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", key_password, keychain])
            run(["security", "list-keychains", "-d", "user", "-s", keychain, *prior])
            project = next(Path("ios").glob("*.xcodeproj"))
            env.update(GLING_PROFILE_UUID=profile["UUID"], GLING_TEAM=TEAM)
            run(["node", "scripts/sign-ios.cjs", str(project / "project.pbxproj")], env=env)
            workspace = next(Path("ios").glob("*.xcworkspace"))
            archive = str(OUT / "app.xcarchive")
            options = OUT / "export.plist"
            options.write_bytes(plistlib.dumps({"method": "app-store-connect", "signingStyle": "manual", "teamID": TEAM, "provisioningProfiles": {PACKAGE: profile["UUID"]}, "manageAppVersionAndBuildNumber": False}))
            run(["xcodebuild", "-workspace", str(workspace), "-scheme", project.stem, "-configuration", "Release", "-destination", "generic/platform=iOS", "-archivePath", archive, "archive"], env=env)
            run(["xcodebuild", "-exportArchive", "-archivePath", archive, "-exportPath", str(OUT / "export"), "-exportOptionsPlist", str(options)], env=env)
            artifact = OUT / "app.ipa"
            artifact.write_bytes(next((OUT / "export").glob("*.ipa")).read_bytes())
            run(["codesign", "--verify", "--deep", "--strict", str(next((OUT / "app.xcarchive/Products/Applications").glob("*.app")))])
        finally:
            try:
                run(["security", "list-keychains", "-d", "user", "-s", *prior])
            finally:
                subprocess.run(["security", "delete-keychain", keychain], capture_output=True)
        with zipfile.ZipFile(artifact) as ipa:
            info = plistlib.loads(ipa.read(next(n for n in ipa.namelist() if re.fullmatch(r"Payload/[^/]+\.app/Info.plist", n))))
        if (info["CFBundleIdentifier"], info["CFBundleShortVersionString"], info["CFBundleVersion"]) != (PACKAGE, app["expo"]["version"], str(number)):
            raise ValueError("IPA version, build number or application ID does not match the release.")
    summary(f"Verified {artifact.name}; SHA256 {hashlib.sha256(artifact.read_bytes()).hexdigest()}")


def summary(message):
    print(message, flush=True)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as file:
            file.write(message + "\n\n")


def submit(platform, env, google, directory):
    version = json.loads(Path("app.json").read_text())["expo"]["version"]
    notes = Path(f"release-notes/{version}.ko.txt").read_text().strip()
    if not notes:
        raise ValueError("Korean release notes are required before submission.")
    if platform == "android":
        token = google_token(google, directory)
        edit = play(token, "/edits", {}, "POST")["id"]
        try:
            bundle = request(f"https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{PACKAGE}/edits/{edit}/bundles?uploadType=media", token, (OUT / "app.aab").read_bytes(), "POST", "application/octet-stream")
            release = {"name": f'{version} ({bundle["versionCode"]})', "versionCodes": [str(bundle["versionCode"])], "status": "completed", "releaseNotes": [{"language": "ko-KR", "text": notes}]}
            play(token, f"/edits/{edit}/tracks/internal", {"track": "internal", "releases": [release]}, "PUT")
            play(token, f"/edits/{edit}:validate", {}, "POST")
            receipt = play(token, f"/edits/{edit}:commit", {}, "POST")
            summary(f'Android internal release committed: {receipt["id"]}, build {bundle["versionCode"]}')
        except Exception:
            try:
                play(token, f"/edits/{edit}", method="DELETE")
            except RuntimeError:
                pass  # An edit already committed is no longer deletable; keep the original failure.
            raise
    else:
        token = run(["asc", "auth", "token", "--confirm"], True, env).strip()
        mask(token)
        api = "https://api.appstoreconnect.apple.com/v1"
        versions = request(f"{api}/apps/{APP}/appStoreVersions?filter[platform]=IOS&limit=200", token)["data"]
        current = next((v for v in versions if v["attributes"]["versionString"] == version), None)
        if current and current["attributes"]["appStoreState"] not in {"PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED"}:
            raise ValueError("This version is already submitted or released; use a new version tag.")
        previous = max((v for v in versions if v["attributes"]["versionString"] != version), key=lambda v: tuple(map(int, v["attributes"]["versionString"].split("."))))
        if not current:
            current = json.loads(run(["asc", "versions", "create", "--app", APP, "--version", version, "--copy-metadata-from", previous["attributes"]["versionString"], "--exclude-fields", "whatsNew", "--copyright", previous["attributes"]["copyright"], "--release-type", "AFTER_APPROVAL", "--output", "json"], True, env))
        version_id = current["id"]
        localizations = request(f"{api}/appStoreVersions/{version_id}/appStoreVersionLocalizations", token)["data"]
        for item in localizations:
            if item["attributes"]["locale"] == "ko":
                request(f'{api}/appStoreVersionLocalizations/{item["id"]}', token, {"data": {"type": "appStoreVersionLocalizations", "id": item["id"], "attributes": {"whatsNew": notes}}}, "PATCH")
        review = request(f'{api}/appStoreVersions/{previous["id"]}/appStoreReviewDetail', token)["data"]
        existing = request(f"{api}/appStoreVersions/{version_id}/appStoreReviewDetail", token).get("data")
        attributes = {k: v for k, v in review["attributes"].items() if k in {"contactFirstName", "contactLastName", "contactPhone", "contactEmail", "demoAccountRequired", "demoAccountName", "demoAccountPassword", "notes"} and v is not None}
        if existing:
            request(f'{api}/appStoreReviewDetails/{existing["id"]}', token, {"data": {"type": "appStoreReviewDetails", "id": existing["id"], "attributes": attributes}}, "PATCH")
        else:
            request(f"{api}/appStoreReviewDetails", token, {"data": {"type": "appStoreReviewDetails", "attributes": attributes, "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": version_id}}}}}, "POST")
        receipt = run(["asc", "publish", "appstore", "--app", APP, "--ipa", str(OUT / "app.ipa"), "--version", version, "--wait", "--timeout", "30m", "--submit", "--confirm", "--output", "json"], True, env)
        result = json.loads(receipt)
        summary(json.dumps({k: result.get(k) for k in ["buildId", "versionId", "submissionId", "submitted"]}))
        run(["asc", "builds", "add-groups", "--build-id", result["buildId"], "--group", "03fefab3-98b9-4f9c-a6a0-450fdd703efb,d403db93-bfb8-42da-b542-5184101817e4", "--submit", "--confirm"], env=env)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["prepare", "build", "submit"])
    parser.add_argument("--platform", choices=["ios", "android"])
    parser.add_argument("--tag")
    parser.add_argument("--build-number", type=int)
    parser.add_argument("--local", action="store_true")
    args = parser.parse_args()
    if args.command == "prepare" and not args.tag:
        parser.error("prepare requires --tag vX.Y.Z")
    if args.command in {"build", "submit"} and not args.platform:
        parser.error("build and submit require --platform ios|android")
    if args.command == "build" and (args.build_number is None or args.build_number < 1):
        parser.error("build requires a positive --build-number")
    if "GITHUB_ACTIONS" in os.environ and os.environ.get("GITHUB_REPOSITORY_VISIBILITY") != "public":
        raise ValueError("Hosted execution is permitted only for the free public repository.")
    with tempfile.TemporaryDirectory(prefix="gling-release-") as temporary:
        directory = Path(temporary)
        env, google = setup(directory, args.local)
        if args.command == "prepare":
            prepare(env, google, directory, args.tag)
        elif args.command == "build":
            build(args.platform, env, directory, args.local, args.build_number)
        else:
            submit(args.platform, env, google, directory)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, KeyError) as error:
        raise SystemExit(str(error)) from None
