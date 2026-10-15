const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process')
function buildShare(destination,arch='arm64') {
  if(!['arm64','x64'].includes(arch))throw new Error('Unsupported share extension architecture')
  const source=path.resolve(__dirname,'../native/share')
  const contents=path.join(destination,'Contents'),binary=path.join(contents,'MacOS/WhyWorkShare')
  fs.mkdirSync(path.dirname(binary),{recursive:true})
  const sdk=execFileSync('xcrun',['--sdk','macosx','--show-sdk-path'],{encoding:'utf8'}).trim()
  execFileSync('xcrun',['swiftc','-swift-version','5','-application-extension','-parse-as-library','-Xlinker','-e','-Xlinker','_NSExtensionMain','-module-name','WhyWorkShare','-sdk',sdk,'-target',`${arch==='x64'?'x86_64':'arm64'}-apple-macosx12.0`,'-framework','AppKit','-framework','UniformTypeIdentifiers',path.join(source,'SharePayload.swift'),path.join(source,'ShareViewController.swift'),'-o',binary],{stdio:'inherit',env:{...process.env,CLANG_MODULE_CACHE_PATH:path.resolve('.cache/swift')}})
  fs.copyFileSync(path.join(source,'Info.plist'),path.join(contents,'Info.plist'))
  execFileSync('codesign',['--force','--sign','-','--timestamp=none','--entitlements',path.join(source,'Share.entitlements'),destination],{stdio:'inherit'})
  execFileSync('codesign',['--verify','--strict',destination],{stdio:'inherit'})
  return destination
}
module.exports={buildShare}
if(require.main===module)console.log(buildShare(path.resolve('out/native/WhyWorkShare.appex'),process.arch))
