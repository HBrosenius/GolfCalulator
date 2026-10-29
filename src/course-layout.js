(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfCourseLayout = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const numbers = holes => Array.from({ length: holes }, (_, i) => i + 1);
  function valid(layout, holes) {
    if (!layout || typeof layout !== 'object' || Object.keys(layout).some(key => !['sourceHoles','holeNumbers','startHole'].includes(key)) || ![9,18].includes(layout.sourceHoles) || ![9,18].includes(holes)) return false;
    const expected = holes === 18 ? numbers(18) : numbers(9).map(h => h + (layout.holeNumbers?.[0] === 10 ? 9 : 0));
    return (holes !== 18 || layout.sourceHoles === 18) && Array.isArray(layout.holeNumbers) && layout.holeNumbers.length === holes && layout.holeNumbers.every((h,i) => h === expected[i] && h <= layout.sourceHoles) && layout.holeNumbers.includes(layout.startHole);
  }
  function standard(holes) { return { sourceHoles: holes, holeNumbers: numbers(holes), startHole: 1 }; }
  function physical(layout, index) { return layout?.holeNumbers?.[index] ?? index + 1; }
  function order(layout, holes) {
    const base = numbers(holes).map(h => h - 1), start = layout?.holeNumbers?.indexOf(layout.startHole) ?? 0;
    return base.slice(Math.max(0,start)).concat(base.slice(0,Math.max(0,start)));
  }
  function nine(course, side, slope, cr) {
    if (course.holes !== 18 || !['front','back'].includes(side) || !Number.isFinite(slope) || slope < 55 || slope > 155 || !Number.isFinite(cr) || cr < 20 || cr > 50) throw new Error('Ange klubbens slope och CR för vald nia.');
    const offset = side === 'back' ? 9 : 0, indices = course.si.slice(offset,offset+9), ranked = indices.slice().sort((a,b) => a-b);
    if (indices.length !== 9 || new Set(indices).size !== 9 || course.hpar.length !== 18) throw new Error('Banans håldata saknas.');
    const {id, ...copy}=structuredClone(course);
    return { ...copy, name: `${course.name.slice(0,64)} · Hål ${offset+1}–${offset+9}`, holes: 9, slope, cr, par: course.hpar.slice(offset,offset+9).reduce((a,b)=>a+b,0),
      ratingHoles: 9, hpar: course.hpar.slice(offset,offset+9), si: indices.map(si => ranked.indexOf(si)*2+1),
      layout: { sourceHoles:18, holeNumbers:numbers(9).map(h=>h+offset), startHole:offset+1 },
      ...(course.catalogId ? {catalogVerificationStatus:'needs-review'} : {}),
    };
  }
  return Object.freeze({valid,standard,physical,order,nine});
}));
