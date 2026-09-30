// Application thresholds are conservative heuristics, not calibrated probabilities.
export function decideCry(results:any[]){
  if(!Array.isArray(results)||results.length<1)throw new Error('Missing detector output');
  const frames=results.map(frame=>{
    const categories=frame.classifications?.[0]?.categories;
    if(!Array.isArray(categories)||categories.length<1)throw new Error('Invalid detector categories');
    const score=(index:number)=>categories.find((c:any)=>c.index===index)?.score??0;
    if(categories.some((c:any)=>!Number.isFinite(c.score)||c.score<0||c.score>1))throw new Error('Invalid detector score');
    return {cry:score(20),speech:Math.max(score(0),score(1),score(2)),music:score(132),categories};
  });
  const average=(key:'cry'|'speech'|'music')=>frames.reduce((sum,x)=>sum+x[key],0)/frames.length;
  const cry=average('cry'),speech=average('speech'),music=average('music');
  const supported=frames.filter(x=>x.cry>=.2&&x.cry>=x.speech&&x.cry>=x.music).length;
  const peak=Math.max(...frames.map(x=>x.cry));
  const competing=Math.max(speech,music)>.25&&Math.max(speech,music)>cry*1.2;
  const detected=!competing&&cry>=.2&&(supported>=2||peak>=.75);
  const totals=new Map<number,number>();
  for(const frame of frames)for(const c of frame.categories)totals.set(c.index,(totals.get(c.index)||0)+c.score/frames.length);
  const top=Array.from(totals).sort((a,b)=>b[1]-a[1])[0];
  return {status:detected?'cry':peak<.1&&top[1]>=.2?'not_cry':'unconfirmed',topIndex:top[0],cryScore:cry};
}
