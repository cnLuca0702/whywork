module.exports={
  appId:'cn.cnluca0702.whywork',productName:'WhyWork',
  directories:{output:'release'},
  electronDist:'node_modules/electron/dist',
  files:['out/**/*','package.json','!out/native/**/*','!tests/**/*','!docs/**/*','!analysis/**/*','!**/*.map'],
  extraResources:[{from:'resources/tessdata',to:'tessdata',filter:['*.traineddata.gz']}],
  asar:true,asarUnpack:['**/*.node','**/tesseract.js/**','**/tesseract.js-core/**'],
  mac:{target:['dmg'],icon:'resources/icon.icns',category:'public.app-category.productivity',identity:null,hardenedRuntime:false,
    extendInfo:{NSMicrophoneUsageDescription:'使用麦克风录制您主动发起的语音笔记。',NSAudioCaptureUsageDescription:'使用您主动选择的系统音频生成转写。'}},
  artifactName:'WhyWork-${version}-${arch}.${ext}',
  protocols:[{name:'WhyWork capture',schemes:['whywork']}],
  afterPack:async context=>{
    if(context.electronPlatformName==='darwin'){
      const {promisify}=require('node:util'),{execFile}=require('node:child_process'),path=require('node:path')
      await promisify(execFile)('codesign',['--force','--deep','--sign','-','--timestamp=none',path.join(context.appOutDir,'WhyWork.app')])
      require('./scripts/build-share.cjs').buildShare(path.join(context.appOutDir,'WhyWork.app/Contents/PlugIns/WhyWorkShare.appex'),context.arch===1?'x64':'arm64')
      await promisify(execFile)('codesign',['--force','--sign','-','--timestamp=none',path.join(context.appOutDir,'WhyWork.app')])
      await promisify(execFile)('codesign',['--verify','--deep','--strict',path.join(context.appOutDir,'WhyWork.app')])
    }
  },
  publish:null
}
