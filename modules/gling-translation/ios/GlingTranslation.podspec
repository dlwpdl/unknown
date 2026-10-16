Pod::Spec.new do |s|
  s.name = 'GlingTranslation'
  s.version = '1.0.0'
  s.summary = 'On-device Korean and English translation for Gling'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Gling'
  s.homepage = 'https://gling.ej-entertainment.com'
  s.source = { :git => 'https://github.com/dlwpdl/unknown.git', :tag => s.version.to_s }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.source_files = '**/*.{h,m,mm,swift}'
  s.dependency 'ExpoModulesCore'
  s.dependency 'GoogleMLKit/Translate', '8.0.0'
end
