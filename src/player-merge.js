(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.GolfPlayerMerge=api;}(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const collections=['rounds','tours','setups','goals'];
  const clone=value=>JSON.parse(JSON.stringify(value));
  const canonical=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]))):value;
  const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
  const error=message=>Object.assign(new Error(message),{status:409});
  function combine(...lists){
    const map=new Map();
    for(const op of lists.flatMap(list=>list||[])){
      const old=map.get(op.id);if(!old){map.set(op.id,clone(op));continue;}
      const base=value=>({id:value.id,source:value.source,targetId:value.targetId,createdAt:value.createdAt});
      if(!same(base(old),base(op))||(old.changes&&op.changes&&!same(old.changes,op.changes)))throw error('Sammanslagningshistoriken skiljer sig mellan kopiorna.');
      const latest=op.revision>old.revision?op:old;
      map.set(op.id,{...clone(latest),...((op.revision===2&&old.revision===2)?{undoneAt:Math.min(op.undoneAt,old.undoneAt)}:{}),...((old.changes||op.changes)?{changes:clone(old.changes||op.changes)}:{})});
    }
    return [...map.values()].sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
  }
  function resolver(ops){
    const map=new Map();for(const op of ops||[])if(op.revision===1){if(map.has(op.source.id)&&map.get(op.source.id)!==op.targetId)throw error('Spelaren har slagits samman till olika profiler.');map.set(op.source.id,op.targetId);}
    return id=>{const seen=new Set();while(map.has(id)){if(seen.has(id))throw error('Sammanslagningarna bildar en cirkel.');seen.add(id);id=map.get(id);}return id;};
  }
  function ids(collection,item){
    if(collection==='rounds')return(item.subjects||[]).flatMap(subject=>[subject.playerId,...(subject.memberIds||[])]).filter(id=>id!=null);
    if(collection==='tours')return item.roster||[];
    if(collection==='setups')return(item.players||[]).map(player=>player.playerId).filter(id=>id!=null);
    if(collection==='goals')return[item.playerId];return[];
  }
  function rewrite(collection,item,resolve){
    const next=clone(item);
    if(collection==='rounds')for(const subject of next.subjects||[]){if(subject.playerId!=null)subject.playerId=resolve(subject.playerId);if(subject.memberIds)subject.memberIds=subject.memberIds.map(id=>id==null?null:resolve(id));}
    if(collection==='tours')next.roster=[...new Set((next.roster||[]).map(resolve))];
    if(collection==='setups')for(const player of next.players||[])if(player.playerId!=null)player.playerId=resolve(player.playerId);
    if(collection==='goals')next.playerId=resolve(next.playerId);
    return next;
  }
  function normalize(data){
    const next=clone(data),ops=combine(data.playerMerges),resolve=resolver(ops);
    if(!ops.length)return next;
    for(const op of ops)resolve(op.source.id);
    const archived=ops.map(op=>op.source),players=[...(next.players||[])];
    // An explicit undo may restore the archived profile, except after a later deletion.
    for(const op of ops)if(op.revision===2&&!ops.some(other=>other.revision===1&&other.source.id===op.source.id)&&!players.some(player=>player.id===op.source.id)&&!(next.playerDeletions||[]).some(item=>item.id===String(op.source.id)&&item.deletedAt>op.createdAt))players.push(clone(op.source));
    next.players=players.filter(player=>resolve(player.id)===player.id);
    const known=[...players,...archived];
    const byName=name=>[...new Set(known.filter(player=>name===player.name||name===(player.nick||player.name)).map(player=>player.id))];
    for(const round of next.rounds||[])for(const subject of round.subjects||[]){
      if(subject.playerId==null&&!subject.members){const matches=byName(subject.name);if(matches.length===1)subject.playerId=matches[0];else if(matches.some(id=>resolve(id)!==id))throw error('Ett äldre scorekort har en tvetydig spelarkoppling.');}
      if(subject.members){subject.memberIds=subject.members.map((name,i)=>{const id=subject.memberIds?.[i];if(id!=null)return id;const matches=byName(name);if(matches.length===1)return matches[0];if(matches.some(value=>resolve(value)!==value))throw error('Ett äldre lagscorekort har en tvetydig spelarkoppling.');return null;});}
    }
    const affected=new Set(ops.filter(op=>op.revision===1).map(op=>resolve(op.targetId))),tourMembers=new Map();
    for(const round of next.rounds||[])if(round.tourRef?.code)for(const subject of round.subjects||[])if(subject.playerId!=null&&subject.memberId&&affected.has(resolve(subject.playerId))){const key=JSON.stringify([round.tourRef.code,resolve(subject.playerId)]);if(!tourMembers.has(key))tourMembers.set(key,new Set());tourMembers.get(key).add(subject.memberId);if(tourMembers.get(key).size>1)throw error('Tourhistoriken kopplar profilerna till olika tourspelare. Granska kopplingarna först.');}
    for(const collection of collections)if(Array.isArray(next[collection]))next[collection]=next[collection].map(item=>{
      const before=ids(collection,item),after=before.map(resolve);
      if(['rounds','setups'].includes(collection)&&new Set(after).size<new Set(before).size)throw error('Båda spelarna finns i samma scorekort eller spelgrupp. Granska kopplingarna först.');
      return rewrite(collection,item,resolve);
    });
    // Preserve merge deletion evidence; undone profiles are the only deliberate exception.
    const undone=new Set(ops.filter(op=>op.revision===2).map(op=>op.source.id));
    next.players=next.players.filter(player=>!(next.playerDeletions||[]).some(item=>item.id===String(player.id)&&(!undone.has(player.id)||item.deletedAt>Math.max(...ops.filter(op=>op.source.id===player.id).map(op=>op.createdAt)))));
    next.playerMerges=ops;return next;
  }
  function prepare(data,sourceId,targetId,id,now=Date.now()){
    if(sourceId===targetId)throw error('Välj två olika spelare.');
    const snapshot=normalize(data),source=snapshot.players.find(player=>player.id===sourceId),target=snapshot.players.find(player=>player.id===targetId);
    if(!source||!target)throw error('Spelarlistan har ändrats. Öppna förhandsgranskningen igen.');
    if((snapshot.playerMerges||[]).length>=100)throw error('Högst 100 sammanslagningar kan sparas.');
    now=Math.max(now,...(snapshot.playerMerges||[]).map(op=>Math.max(op.createdAt,op.undoneAt||0)+1));
    const changes=[];
    for(const collection of collections)for(const item of snapshot[collection]||[]){const after=rewrite(collection,item,value=>value===sourceId?targetId:value);if(!same(item,after))changes.push({collection,id:String(item.id),before:clone(item),after});}
    const op={id,source:clone(source),targetId,createdAt:now,revision:1,changes};
    const next=normalize({...snapshot,playerMerges:combine(snapshot.playerMerges,[op]),playerDeletions:[...(snapshot.playerDeletions||[]).filter(item=>item.id!==String(sourceId)),{id:String(sourceId),deletedAt:now}]});
    return{snapshot:next,operation:op,counts:Object.fromEntries(collections.map(collection=>[collection,changes.filter(change=>change.collection===collection).length]))};
  }
  function undo(data,id,now=Date.now()){
    const snapshot=normalize(data),op=(snapshot.playerMerges||[]).find(item=>item.id===id);
    if(!op||op.revision!==1||!op.changes)throw error('Ångerdata saknas eller sammanslagningen är redan ångrad.');
    if(snapshot.playerMerges.some(other=>other.revision===1&&other.id!==id&&other.createdAt>=op.createdAt&&[other.source.id,other.targetId].some(value=>[op.source.id,op.targetId].includes(value))))throw error('Ångra senare sammanslagningar av dessa spelare först.');
    for(const change of op.changes){const current=(snapshot[change.collection]||[]).find(item=>String(item.id)===change.id);if(!same(current,change.after))throw error('Berörda uppgifter har ändrats efter sammanslagningen. Ångring skulle skriva över dem.');}
    const next=clone(snapshot);
    for(const change of op.changes)next[change.collection]=next[change.collection].map(item=>String(item.id)===change.id?clone(change.before):item);
    next.playerMerges=next.playerMerges.map(item=>item.id===id?{...item,revision:2,undoneAt:Math.max(now,item.createdAt+1)}:item);
    return normalize(next);
  }
  function links(records,ops){const resolve=resolver(ops);return(records||[]).map(record=>{const memberLinks={};for(const[key,value]of Object.entries(record.memberLinks||{})){const next=String(resolve(Number(key)));if(memberLinks[next]&&memberLinks[next]!==value)throw error(`Touren ${record.tour?.name||record.code} kopplar profilerna till olika tourspelare.`);memberLinks[next]=value;}return{...record,memberLinks};});}
  function state(current,ops){
    const next=clone(current);if(!(ops||[]).some(op=>op.revision===1))return next;const resolve=resolver(ops);
    if(next.playerIds)next.playerIds=next.playerIds.map(id=>id==null?id:resolve(id));
    for(const player of next.players||[])if(player.playerId!=null)player.playerId=resolve(player.playerId);
    for(const team of next.teams||[])for(const member of team.members||[])if(member.playerId!=null)member.playerId=resolve(member.playerId);
    if(next._scoreSetupKey)try{const key=JSON.parse(next._scoreSetupKey);key.players?.forEach(player=>{if(player[0]!=null)player[0]=resolve(player[0]);});next._scoreSetupKey=JSON.stringify(key);}catch(_){}
    const all=[...(next.playerIds||[]).filter(id=>id!=null)];if(new Set(all).size<all.length)throw error('Utkastet innehåller båda sammanslagna profilerna. Ångra sammanslagningen innan du fortsätter.');
    return next;
  }
  function valid(op,checks){
    if(!op||typeof op!=='object'||Array.isArray(op)||Object.keys(op).some(key=>!['id','source','targetId','createdAt','revision','undoneAt','changes'].includes(key))||typeof op.id!=='string'||!op.id.length||op.id.length>80||!checks.players(op.source)||!Number.isSafeInteger(op.targetId)||op.targetId<1||op.targetId===op.source.id||!Number.isSafeInteger(op.createdAt)||op.createdAt<1||![1,2].includes(op.revision))return false;
    if(op.revision===1?op.undoneAt!==undefined:!Number.isSafeInteger(op.undoneAt)||op.undoneAt<=op.createdAt)return false;
    return op.changes===undefined||(Array.isArray(op.changes)&&op.changes.length<=5000&&op.changes.every(change=>change&&Object.keys(change).every(key=>['collection','id','before','after'].includes(key))&&collections.includes(change.collection)&&typeof change.id==='string'&&change.id===String(change.before?.id)&&change.id===String(change.after?.id)&&checks[change.collection](change.before)&&checks[change.collection](change.after)&&same(rewrite(change.collection,change.before,id=>id===op.source.id?op.targetId:id),change.after)));
  }
  return{combine,normalize,prepare,undo,links,state,valid,resolver,same};
}));
