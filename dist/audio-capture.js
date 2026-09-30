// A 3.072-second mono ring buffer with a 1.536-second hop. Never saved or uploaded.
class CryCapture extends AudioWorkletProcessor {
  constructor(){super();this.capacity=Math.round(sampleRate*3.072);this.hop=Math.round(sampleRate*1.536);this.buffer=new Float32Array(this.capacity);this.offset=0;this.filled=0;this.since=0;this.sequence=0;}
  process(inputs,outputs){
    for(const channel of (outputs[0]||[]))channel.fill(0);
    const input=inputs[0];if(!input?.length)return true;
    for(let i=0;i<input[0].length;i++){
      let value=0;for(const channel of input)value+=channel[i];
      this.buffer[this.offset]=value/input.length;this.offset=(this.offset+1)%this.capacity;this.filled++;this.since++;
      if(this.filled>=this.capacity&&(this.sequence===0||this.since>=this.hop)){
        const clip=new Float32Array(this.capacity);clip.set(this.buffer.subarray(this.offset));clip.set(this.buffer.subarray(0,this.offset),this.capacity-this.offset);
        this.port.postMessage({samples:clip,sampleRate,sequence:++this.sequence},[clip.buffer]);this.since=0;
      }
    }
    return true;
  }
}
registerProcessor('cry-capture',CryCapture);
