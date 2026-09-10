import {PassThrough} from 'node:stream';
export class TerminalInput extends PassThrough {
  constructor(source) {
    super(); this.source=source; this.isTTY=source.isTTY; this.buffer='';
    this.forward=data=>this.feed(data.toString());
    source.on('data',this.forward);
  }
  setRawMode(value){this.source.setRawMode(value);return this;}
  ref(){this.source.ref?.();return this;}
  unref(){this.source.unref?.();return this;}
  feed(text){
    this.buffer+=text;
    while(this.buffer){
      const start=this.buffer.indexOf('\x1b[<');
      if(start<0){
        const partial=['\x1b[','\x1b'].find(s=>this.buffer.endsWith(s));
        if(partial){const prefix=this.buffer.slice(0,-partial.length);if(prefix)this.write(prefix);this.buffer=partial;clearTimeout(this.flushTimer);this.flushTimer=setTimeout(()=>{this.write(this.buffer);this.buffer='';},30);}
        else{this.write(this.buffer);this.buffer='';}
        return;
      }
      clearTimeout(this.flushTimer);
      if(start>0){this.write(this.buffer.slice(0,start));this.buffer=this.buffer.slice(start);}
      const match=this.buffer.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
      if(!match){if(this.buffer.length>40){this.buffer='';}return;}
      this.emit('mouse',{button:Number(match[1]),x:Number(match[2])-1,y:Number(match[3])-1,release:match[4]==='m'});
      this.buffer=this.buffer.slice(match[0].length);
    }
  }
  close(){clearTimeout(this.flushTimer);this.source.off('data',this.forward);this.destroy();}
}
