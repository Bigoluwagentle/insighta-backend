function uuidv7() {
  const now = BigInt(Date.now());
  const tsMsHigh = Number((now >> 16n) & 0xffffffffn);
  const tsMsLow  = Number(now & 0xffffn);
  const randA = Math.floor(Math.random() * 0xfff);
  const randBHigh = Math.floor(Math.random() * 0x3fffffff);
  const randBLow  = Math.floor(Math.random() * 0xffffffff);
  const p1 = tsMsHigh.toString(16).padStart(8, "0");
  const p2 = tsMsLow.toString(16).padStart(4, "0");
  const p3 = (0x7000 | randA).toString(16).padStart(4, "0");
  const p4 = (0x8000 | (randBHigh & 0x3fff)).toString(16).padStart(4, "0");
  const p5 = randBLow.toString(16).padStart(8, "0") +
             Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

module.exports = { uuidv7 };