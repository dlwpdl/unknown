import ExpoModulesCore
import MLKitCommon
import MLKitTranslate

public class GlingTranslationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("GlingTranslation")

    AsyncFunction("translate") { (texts: [String], target: String, promise: Promise) in
      guard ["ko", "en"].contains(target), !texts.isEmpty, texts.count <= 256,
        texts.reduce(0, { $0 + $1.utf16.count }) <= 20000 else {
        promise.reject("INVALID_TRANSLATION_INPUT", "Unsupported translation input")
        return
      }
      let options = TranslatorOptions(
        sourceLanguage: target == "ko" ? .english : .korean,
        targetLanguage: target == "ko" ? .korean : .english
      )
      let translator = Translator.translator(options: options)
      let conditions = ModelDownloadConditions(allowsCellularAccess: false, allowsBackgroundDownloading: false)
      translator.downloadModelIfNeeded(with: conditions) { error in
        guard error == nil else {
          promise.reject("MODEL_DOWNLOAD_FAILED", "Language pack could not be prepared over Wi-Fi")
          return
        }
        self.translateNext(texts, index: 0, result: [], translator: translator, promise: promise)
      }
    }
  }

  private func translateNext(_ texts: [String], index: Int, result: [String], translator: Translator, promise: Promise) {
    guard index < texts.count else { promise.resolve(result); return }
    translator.translate(texts[index]) { text, error in
      guard error == nil, let text else {
        promise.reject("TRANSLATION_UNAVAILABLE", "Text could not be translated on this device")
        return
      }
      self.translateNext(texts, index: index + 1, result: result + [text], translator: translator, promise: promise)
    }
  }
}
