Pod::Spec.new do |s|
  s.name = 'T3WatchBridge'
  s.version = '1.0.0'
  s.summary = 'WatchConnectivity bridge between T3 Code mobile and its Apple Watch app.'
  s.description = 'Sends thread snapshots to the T3 Code watch app and queues the answers the watch sends back.'
  s.author = 'T3 Tools'
  s.homepage = 'https://t3tools.com'
  s.platform = :ios, '18.0'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WatchConnectivity', 'WebKit'
  s.source_files = '*.swift'
end
