export default class Vec3 { constructor(x,y,z){ this.x=x; this.y=y; this.z=z } offset(dx,dy,dz){ return new Vec3(this.x+dx, this.y+dy, this.z+dz) } }  
