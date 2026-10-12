import assert from 'node:assert/strict';
import test from 'node:test';
import { getSuggestedHashtags } from '../src/lib/hashtags.ts';

test('commercial and residential filters stay first even when other tags are more popular',()=>{
  const category={id:14,slug:'housing'};
  const posts=Array.from({length:20},(_,i)=>({tag:category,hashtags:[`정보${i}`]}));
  assert.deepEqual(getSuggestedHashtags(posts,category,5).slice(0,2),['상업용','주거용']);
});

test('a nonempty server trend response retains property filters and deduplicates them',()=>{
  const category={id:14,slug:'housing'};
  assert.deepEqual(getSuggestedHashtags([],category,10,['렌트','상업용']),['상업용','주거용','렌트']);
  assert.deepEqual(getSuggestedHashtags([],{id:4,slug:'food'},10,['인기맛집']),['인기맛집']);
});
