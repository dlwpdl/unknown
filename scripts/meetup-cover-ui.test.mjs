import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
test('cover picker preserves draft on cancel, optimizes selection, and supports removal', async () => {
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/meetup-cover-picker.tsx', import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  let result={canceled:true}, selected='unchanged', options;
  const exports={};
  vm.runInNewContext(source,{exports,require(name){
    if(name==='react') return {useState:value=>[value,()=>{}],useRef:value=>({current:value}),useLayoutEffect:fn=>fn()};
    if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
    if(name==='react-native')return {Pressable:'Pressable',View:'View',StyleSheet:{create:x=>x}};
    if(name==='expo-image')return {Image:'Image'};
    if(name==='expo-image-picker')return {UIImagePickerPreferredAssetRepresentationMode:{Compatible:'compatible'},launchImageLibraryAsync:async value=>{options=value;return result;}};
    if(name==='@/hooks/use-theme')return {useTheme:()=>({})};
    if(name==='@/lib/interaction-feedback')return {useInteractionFeedback:()=>({play(){}})};
    if(name==='@/lib/post-image-picker')return {
      isSupportedImage:mimeType=>['image/jpeg','image/png','image/webp'].includes(mimeType),
      preparePostImage:async(asset,settings)=>{prepareCalls.push([asset.mimeType,settings]);
        return {uri:'optimized.webp',base64:'aGk=',thumbBase64:'dGh1bWI=',mimeType:'image/webp',width:1280,height:720,bytes:3};},
    };
    if(name==='@/components/themed-text')return {ThemedText:'Text'};
    return {};
  }});
  const find=(node,label)=>node&&typeof node==='object'?(node.props?.accessibilityLabel===label?node:Object.values(node).flatMap(x=>Array.isArray(x)?x:[x]).map(x=>find(x,label)).find(Boolean)):null;
  const picking=[],prepareCalls=[];
  const props={value:null,onChange:value=>{selected=value;},onPickingChange:value=>picking.push(value),disabled:false};
  await find(exports.MeetupCoverPicker(props),'모임 사진 추가').props.onPress();
  assert.equal(selected,'unchanged');
  assert.deepEqual(picking,[true,false]);
  result={canceled:false,assets:[{uri:'source.jpg',width:3200,height:1800,mimeType:'image/jpeg'}]};
  await find(exports.MeetupCoverPicker(props),'모임 사진 추가').props.onPress();
  assert.equal(selected.uri,'optimized.webp');assert.equal(selected.base64,'aGk=');
  assert.equal(selected.thumbBase64,'dGh1bWI=');assert.equal(selected.mimeType,'image/webp');
  assert.equal(prepareCalls.length,1);
  assert.equal(prepareCalls[0][0],'image/jpeg');
  assert.equal(prepareCalls[0][1].withThumb,true);
  assert.equal(options.preferredAssetRepresentationMode,'compatible');
  const tree=exports.MeetupCoverPicker({...props,value:selected});
  find(tree,'커버 사진 삭제').props.onPress();assert.equal(selected,null);
  assert.equal(find(exports.MeetupCoverPicker({...props,disabled:true}),'모임 사진 추가').props.disabled,true);
});
