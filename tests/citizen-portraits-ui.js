'use strict';
/* Actual UI methods + real simulation in repository DOM fixture, not browser QA. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'household-supply-ui.js'),'utf8'),context={require,console,Blob,__dirname,module:{exports:{}}};
vm.runInNewContext(source.slice(0,source.indexOf('let passed'))+'\nmodule.exports=fixture;',context);const fixture=context.module.exports;
const f=fixture(),G=f.G,c=f.resident(f.building('house'));Object.assign(c,{age:30,sex:'m'});G.sel={kind:'c',id:c.id};G.ui.showInfo();
let holder=f.info.querySelector('[data-citizen-portrait]');assert(holder);assert.match(holder.querySelector('img').getAttribute('src'),/adult-man-0[12]\.png/);
const close=f.info.querySelector('#info-close');close.focus();const writes=f.info.htmlWrites,portraitWrites=holder.htmlWrites,key=G.ui.citizenPortraitKey(c);const before=JSON.stringify(G.serializeGame());
for(let i=0;i<10;i++)G.ui.renderInfo();assert.equal(JSON.stringify(G.serializeGame()),before);assert.equal(f.info.htmlWrites,writes);assert.equal(holder.htmlWrites,portraitWrites);assert.equal(f.doc.activeElement,close);
c.job=f.building('woodcutter').id;G.ui.renderInfo();assert.equal(G.ui.citizenPortraitKey(c),key);assert.match(f.info.querySelector('[data-citizen-job]').textContent,/伐木|木柴|劈柴|樵/);
c.age=60;G.ui.renderInfo();assert.match(holder.querySelector('img').getAttribute('src'),/elder-man-01/);assert.equal(f.doc.activeElement,close);
c.sex=null;G.ui.renderInfo();assert(!holder.querySelector('img'));assert.match(f.info.querySelector('[data-citizen-role]').textContent,/性别未知/);
// Existing school/medical list methods, with synthetic read-only query results.
c.sex='f';c.age=30;c.student=true;const school=f.building('school');c.school=school.id;G.schoolTeachers=()=>[];f.select(school);G.ui.refreshSchoolStudents(school);let list=f.info.querySelector('[data-school-student-list]');assert.match(list.innerHTML,/citizen-portrait is-compact/);assert.match(list.innerHTML,/adult-woman-0[12]/);
const hospital=f.building('hospital');G.medicalPatients=()=>[c];f.select(hospital);G.ui.refreshMedicalPatients(hospital);list=f.info.querySelector('[data-medical-patient-list]');assert.match(list.innerHTML,/citizen-portrait is-compact/);assert.match(list.innerHTML,/adult-woman-0[12]/);
console.log('PASS: portrait DOM, focused in-place refresh without remount, real job text, age/unknown fallback, school and medical list markup');
