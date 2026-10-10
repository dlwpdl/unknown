import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { membershipOffer } from '../src/lib/membership.ts';

function provider(platform, initial, { bindingFails=false, namedOffering=false, switchOnBind=false, draft=false }={}) {
  const hooks=[]; let cursor=0, user='member', snapshot=initial, purchased=[], binds=[], notices=[];
  const item={ identifier:'business_pro_monthly', product:{ identifier:platform==='ios'?'com.dlwpdl.gling.business.pro.monthly.v2':'gling_business_pro_v2:monthly',priceString:'CA$49.00',subscriptionPeriod:'P1M' } };
  const offer=membershipOffer(item);
  const exports={};
  const source=ts.transpileModule(fs.readFileSync(new URL('../src/lib/membership-provider.tsx',import.meta.url),'utf8'),{ compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX} }).outputText;
  vm.runInNewContext(source,{exports,Map,require(name){
    if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props})};
    if(name==='react')return {
      createContext:()=>({Provider:'Provider'}),useCallback:fn=>fn,useEffect(){},useLayoutEffect:fn=>fn(),
      useRef(initial){const i=cursor++;return hooks[i]??={current:initial};},
      useState(initial){const i=cursor++;if(!(i in hooks))hooks[i]=initial;return [hooks[i],next=>{hooks[i]=typeof next==='function'?next(hooks[i]):next;}];},
    };
    if(name==='react-native')return {Platform:{OS:platform},Linking:{openURL:async url=>notices.push(url)}};
    if(name==='@/lib/auth')return {useAuth:()=>({isAuthed:true,me:{id:user}})};
    if(name==='@/lib/membership')return {membershipOffer};
    if(name==='@/lib/supabase')return {supabase:{
      auth:{getSession:async()=>({data:{session:{user:{id:user}}}})},
      rpc:async(name,args)=>{
        if(name==='bind_business_membership'){
          binds.push(args.p_merchant_id);if(switchOnBind){user='other';render();}
          return {error:bindingFails?new Error('MERCHANT_OWNER_REQUIRED'):null};
        }
        return {data:snapshot};
      },
      functions:{invoke:async()=>({data:{membership:snapshot}})},
    }};
    if(name==='@/lib/purchases')return {purchaseUnavailableReason:()=>null,withPurchases:async(uid,fn)=>{
      if(uid!==user)throw new Error('ACCOUNT_CHANGED');
      return fn({
        PRORATION_MODE:{DEFERRED:'deferred'},getOfferings:async()=>({current:{availablePackages:namedOffering?[]:[item],metadata:{billing_policy_version:2,launch_status:draft?'draft':'ready'}},all:{gling_business_v2:{availablePackages:[item],metadata:{billing_policy_version:2,launch_status:draft?'draft':'ready'}}}}),
        purchasePackage:async(pkg,_unused,change)=>{
          purchased.push({id:pkg.product.identifier,change});
          snapshot={...snapshot,businessSubscription:{tier:'pro',productId:pkg.product.identifier,store:platform==='ios'?'app_store':'play_store',merchantId:'business-one'}};
        },restorePurchases:async()=>{},
      });
    }};
    throw new Error(name);
  }});
  const render=()=>{cursor=0;return exports.MembershipProvider({}).props.value;};
  return {render,offer,purchased,binds,notices};
}

const freeBusiness={tier:'free',productId:null,store:null,merchantId:null};
test('a business purchase preserves general subscription and never replaces its Android product',async()=>{
  for(const platform of ['ios','android']){
    const p=provider(platform,{tier:'plus',productId:'existing-general',store:platform==='ios'?'app_store':'play_store',billingPolicyVersion:2,businessSubscription:freeBusiness});
    await p.render().refresh();await p.render().purchase(p.offer,'business-one');
    assert.equal(p.purchased.length,1);assert.equal(p.purchased[0].change,null);
    assert.deepEqual(p.binds,['business-one']);assert.equal(p.render().membership.productId,'existing-general');
  }
});
test('Android business changes use only the verified business product',async()=>{
  const p=provider('android',{tier:'premium',productId:'existing-general',store:'play_store',billingPolicyVersion:2,businessSubscription:{tier:'plus',productId:'existing-business',store:'play_store',merchantId:'business-one'}});
  await p.render().refresh();await p.render().purchase(p.offer,'business-one');
  assert.equal(p.purchased[0]?.change?.oldProductIdentifier,'existing-business');
});
test('a general subscription from another store does not block the separate business family',async()=>{
  const p=provider('ios',{tier:'plus',productId:'general-google',store:'play_store',billingPolicyVersion:2,businessSubscription:freeBusiness});
  await p.render().refresh();await p.render().purchase(p.offer,'business-one');assert.equal(p.purchased.length,1);
});
test('business cross-store renewal and ownership failures stop before charging',async()=>{
  for(const options of [{bindingFails:true},{foreign:true}]){
    const p=provider('ios',{tier:'free',productId:null,billingPolicyVersion:2,businessSubscription:options.foreign?{tier:'plus',productId:'business-google',store:'play_store'}:freeBusiness},options);
    await p.render().refresh();await p.render().purchase(p.offer,'business-one');assert.equal(p.purchased.length,0);
  }
});
test('missing policy migration and tampered offer scope cannot reach the store',async()=>{
  const p=provider('ios',{tier:'free',productId:null});await p.render().refresh();await p.render().purchase(p.offer,'business-one');assert.equal(p.purchased.length,0);
  const ready=provider('ios',{tier:'free',productId:null,billingPolicyVersion:2,businessSubscription:freeBusiness});await ready.render().refresh();
  await ready.render().purchase({...ready.offer,kind:'general'});assert.equal(ready.purchased.length,0);
});
test('named family offering works without replacing the legacy current offering',async()=>{
  const p=provider('ios',{tier:'free',productId:null,billingPolicyVersion:2,businessSubscription:freeBusiness},{namedOffering:true});
  await p.render().refresh();assert.equal(p.render().offers.some(x=>x.kind==='business'),true);
});
test('account switch during business binding prevents a store call and stale entitlement display',async()=>{
  const p=provider('ios',{tier:'free',productId:null,billingPolicyVersion:2,businessSubscription:freeBusiness},{switchOnBind:true});
  await p.render().refresh();await p.render().purchase(p.offer,'business-one');assert.equal(p.purchased.length,0);assert.equal(p.render().membership,null);
});
test('draft catalog never exposes a paid package or accepts a stale purchase action',async()=>{
  const p=provider('ios',{tier:'free',productId:null,billingPolicyVersion:2,businessSubscription:freeBusiness},{draft:true});
  await p.render().refresh();assert.equal(p.render().offers.length,0);await p.render().purchase(p.offer,'business-one');assert.equal(p.purchased.length,0);
});
