// Band-limited downsampling prevents frequencies above 8kHz from folding into
// the 16kHz model input. Polyphase kernels are reused within a worker session.
const phases=64;
let cachedRate=0,cachedRadius=0,cachedKernels:Float64Array[]=[];
function kernelsFor(rate:number){
  if(rate===cachedRate)return {radius:cachedRadius,kernels:cachedKernels};
  const radius=Math.ceil(24*rate/16000),cutoff=7200/rate;
  const kernels=Array.from({length:phases},(_,phase)=>{
    const fraction=phase/phases,weights=new Float64Array(2*radius+1);let sum=0;
    for(let tap=-radius;tap<=radius;tap++){
      const distance=tap-fraction;
      const window=Math.abs(distance)>radius?0:.42+.5*Math.cos(Math.PI*distance/radius)+.08*Math.cos(2*Math.PI*distance/radius);
      const sinc=Math.abs(distance)<1e-12?2*cutoff:Math.sin(2*Math.PI*cutoff*distance)/(Math.PI*distance);
      const weight=sinc*window;weights[tap+radius]=weight;sum+=weight;
    }
    for(let i=0;i<weights.length;i++)weights[i]/=sum;
    return weights;
  });
  cachedRate=rate;cachedRadius=radius;cachedKernels=kernels;return {radius,kernels};
}
export function resampleMono(input:Float32Array,rate:number,count=49152){
  if(!Number.isFinite(rate)||rate<8000||rate>192000||!input.length||!Number.isInteger(count)||count<1)throw new Error('Invalid resampling input');
  const output=new Float32Array(count);
  if(rate<=16000){
    for(let i=0;i<count;i++){
      const position=i*rate/16000,lo=Math.min(input.length-1,Math.floor(position)),hi=Math.min(input.length-1,lo+1),mix=position-Math.floor(position);
      output[i]=input[lo]*(1-mix)+input[hi]*mix;
    }
    return output;
  }
  const {radius,kernels}=kernelsFor(rate);
  for(let i=0;i<count;i++){
    const position=i*rate/16000,center=Math.floor(position),phase=Math.floor((position-center)*phases),weights=kernels[phase];let value=0;
    for(let tap=-radius;tap<=radius;tap++)value+=input[Math.max(0,Math.min(input.length-1,center+tap))]*weights[tap+radius];
    output[i]=value;
  }
  return output;
}
