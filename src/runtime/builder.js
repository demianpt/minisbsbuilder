/**
 * Builder domain runtime. The core and v2 extension share a lexical scope,
 * so they intentionally initialize together behind this single boundary.
 */
import { DIALS, DIAL_GROUPS, DIAL_KEYS, DIAL_PRESETS, dialCss, dialDocumentAttributes, dialLabel, dialLevels, dialTokens, ensureDials } from '../../shared/design/dials.mjs';
import { BUTTON_STYLES, buttonStyle, buttonStyleCss, buttonStylePreviewMarkup, normalizeButtonStyle } from '../../shared/design/button-styles.mjs';
import { CONCEPT_DESIGN_KEYS, conceptFromDesign, normalizeConceptList, resolveConceptDesign } from '../../shared/design/concepts.mjs';
import { CONCEPT_IDS, CONCEPT_SLOTS, CONCEPT_VARIANTS, CONCEPT_VARIANT_TYPES, bindProject, conceptHasDraftChanges, conceptIdFrom, conceptIndexOf, conceptIsolationDiff, conceptPublishLabel, duplicateConcept, generateConceptSet, getActiveConcept, getActiveConceptId, getConcept, hasGeneratedConceptSet, listConcepts, listGeneratedConcepts, migrateProject, projectToJson, resetConcept, serializeProject, setActiveConcept, snapshotWorkspace, touchConcept } from '../../shared/concepts/workspace.mjs';
import { createConceptHistory } from '../../shared/concepts/history.mjs';
import { STYLE_FAMILIES, allStyles, loadStyleLibrary, productionStyles, styleByKey, styleCounts, styleFamilies, styleFromRef, styleKey, stylesInFamily } from '../../shared/styles/catalog.mjs';
import { VARIANT_RULES, compilePatternWeight, compileSectionRecipe, compileStyle, styleSummary, variantRule } from '../../shared/styles/compiler.mjs';
import { PALETTE_ROLES as PALETTE_ROLE_KEYS, contrastRatio as paletteContrast, paletteContrastReport, readableOn, repairPalette } from '../../shared/design/palette.mjs';
import { SECTION_FAMILIES } from '../../shared/brief/families.mjs';
import { isPeopleFamily } from '../../shared/brief/media.mjs';
import { briefDirectives } from '../../shared/brief/planner.mjs';
import { BRIEF_DOCUMENT_ACCEPT, BRIEF_TEXT_LIMIT, briefDocumentKind, isBriefDocument, readBriefDocument, readBriefDocuments } from '../../shared/brief/documents.mjs';
import { fontOptions } from '../../shared/design/fonts.mjs';
import { createConceptSetBundle, createProjectBundle, downloadBlob } from '../utils/project-bundle.js';

export function initializeBuilder(DATA, DST_SHARED_CSS, briefBrainFeature = {}, { styleLibrary = null } = {}) {
/*
 * The style library.
 *
 * Ten families, fifty production style profiles, built from
 * `style-factory/style-seeds.json` by `npm run styles:build`. A style resolves to
 * palette, type, radius, a button family, all nine dials, a per-section recipe and
 * a pattern-preference weighting — which is what stops it being a palette preset.
 */
loadStyleLibrary(styleLibrary);
const STEPS=[
  {title:'Brief',sub:'What this page must do'},
  {title:'Direction',sub:'Archetype and design tokens'},
  {title:'Page flow',sub:'SBS structure and rhythm'},
  {title:'Modules',sub:'Patterns, content and media'},
  {title:'Review & export',sub:'Validate, JSON and HTML'}
];
const ICONS={
  arrow:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  check:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  plus:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  copy:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="1"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  trash:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></svg>',
  grip:'⋮⋮'
};
const familyLabels={hero:'Hero',text:'Statement / text',logo:'Logo marquee',stats:'Statistics',split:'Media + text',cards:'Cards',tabs:'Tabs',timeline:'Timeline',testimonial:'Testimonials',cta:'Call to action',faq:'FAQ',slider:'Slider',pricing:'Pricing',gallery:'Gallery',contact:'Contact',blog:'Content feed',team:'Team',accordion:'Accordion',haccordion:'Horizontal accordion'};
let uidCounter=0;
const deepClone=v=>JSON.parse(JSON.stringify(v));
const esc=v=>String(v??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const escAttr=esc;
const stripHtml=v=>String(v??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const slugify=v=>String(v||'page').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,64)||'page';
const uid=(prefix='id')=>`${prefix}-${Date.now().toString(36)}-${(++uidCounter).toString(36)}`;
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const byId=id=>document.getElementById(id);
const patternMap=new Map(DATA.patterns.map(p=>[p.id,p]));
/*
 * One canonical flow catalogue.
 *
 * The catalogue is the data file and nothing else. Two later layers used to push
 * their own flows onto `DATA.flows` at boot and `v3EnsureCustomFlows` pushed every
 * loaded project's typed flows on top, so the number of flows in the product
 * depended on which projects a session had opened and no two places — data,
 * runtime, tests, README — agreed on the count.
 *
 * A flow a strategist types stays on their project. `allFlows` is the only view
 * that joins the two, and it builds a new array rather than growing the
 * catalogue.
 */
const FLOW_CATALOG=Object.freeze(DATA.flows.map(function(flow){return Object.freeze(flow)}));
function projectCustomFlows(project){
  const list=(project||state.project||{}).customFlows;
  return Array.isArray(list)?list:[];
}
/** The catalogue plus the current project's own typed flows. */
function allFlows(project){
  const custom=projectCustomFlows(project);
  return custom.length?FLOW_CATALOG.concat(custom):FLOW_CATALOG;
}
function flowById(id,project){
  const list=allFlows(project);
  for(let i=0;i<list.length;i+=1)if(list[i].id===id)return list[i];
  return null;
}
function flowExists(id,project){return Boolean(flowById(id,project))}
const familyPatterns=family=>DATA.patterns.filter(p=>p.family===family);
const mediaAt=(i=0)=>DATA.media[(i+DATA.media.length)%DATA.media.length]||{src:'',alt:'Placeholder image',source:'skill'};
const mediaByGroup=(group,fallback=0)=>DATA.media.find(m=>m.group===group)||mediaAt(fallback);
// A media object may now describe a clip as well as a still. `kind` is the only
// discriminator anything downstream needs; `poster` keeps a video from showing a
// blank rectangle while it buffers, and `assetId` is what a client licenses.
const asMedia=m=>{const kind=m.kind==='video'?'video':'image';const out={src:m.src,alt:m.alt||'Editorial placeholder image',source:m.source||'Pexels',intent:m.intent||(kind==='video'?'editorial-video':'editorial-photo'),kind,ratioDesktop:m.ratioDesktop||'16/9',ratioMobile:m.ratioMobile||'4/3'};if(kind==='video'){out.poster=m.poster||'';out.mime=m.mime||'video/mp4'}if(m.assetId){out.assetId=String(m.assetId);out.provider=m.provider||'';out.licence=m.licence||'preview';out.licenceUrl=m.url||m.licenceUrl||''}return out};
const isVideoMedia=m=>Boolean(m)&&(m.kind==='video'||m.type==='video'||/\.(mp4|webm|mov)(\?|$)/i.test(String(m.src||m.url||'')));
/**
 * Families whose card grid actually carries a picture per item. Others — pricing,
 * stats, contact, accordion — have a card node in the tree but render their items
 * as text, so a picture assigned there would be stored and never seen.
 */
const CARD_MEDIA_FAMILIES=['cards','slider','gallery','team','blog','testimonial'];
function walkNode(node,fn,parent=null){if(!node)return;fn(node,parent);(node.children||[]).forEach(c=>walkNode(c,fn,node));}
function allNodes(node,component){const out=[];walkNode(node,n=>{if(!component||n.component===component)out.push(n)});return out}
function firstNode(node,component){let found=null;walkNode(node,n=>{if(!found&&n.component===component)found=n});return found}
function stripComponents(node,components){if(!node)return node;node.children=(node.children||[]).filter(child=>!components.has(child.component)).map(child=>stripComponents(child,components));return node}
function rekeyTree(node,prefix){let i=0;walkNode(node,n=>{n.id=`${prefix}-b${++i}`});}
function patternFor(id,family){return patternMap.get(id)||familyPatterns(family)[0]||DATA.patterns[0]}
function cleanText(value){return String(value??'').replace(/\s+/g,' ').trim()}
/**
 * A CSS value as authored in the pattern catalogue, made safe to concatenate
 * into a `style` attribute. Catalogue values carry the line breaks and the
 * trailing semicolon they were pasted with, which is how the p89 v3 hero ended
 * up rendering `background:linear-gradient(…);;opacity:1;`.
 */
function cleanCssValue(value){return cleanText(value).replace(/;+$/,'').trim()}
function normalizeLink(value){if(value&&typeof value==='object')value=value.url||value.href||'#';const v=String(value||'#').trim();if(!v)return '#';if(v.startsWith('#')||v.startsWith('/')||v.startsWith('http')||v.startsWith('mailto:')||v.startsWith('tel:'))return v;return `#${slugify(v)}`}
function announce(message){const toast=byId('toast'),text=byId('toastText');text.textContent=message;toast.classList.add('show');clearTimeout(announce.t);announce.t=setTimeout(()=>toast.classList.remove('show'),2200)}
function safeJson(value){try{return JSON.parse(value)}catch(e){return null}}
function getPath(obj,path){return path.split('.').reduce((o,k)=>o?.[k],obj)}
function setPath(obj,path,value){const keys=path.split('.');let ref=obj;for(let i=0;i<keys.length-1;i++){const key=keys[i];if(ref[key]==null||typeof ref[key]!=='object')ref[key]={};ref=ref[key]}ref[keys[keys.length-1]]=value}
function downloadFile(name,content,type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
function mediaChoice(section,index=0){const src=section.content?.media?.[index]||section.content?.media||mediaAt(index);return asMedia(src.src?src:mediaAt(index))}

const defaultCopy={
 hero:{pretitle:'CONTINUITY OF OPERATIONS · FEDERAL & DEFENSE',title:'Readiness that holds when the plan does not.',subtitle:'Vision Continuity stands up, exercises and sustains continuity programs for federal agencies and defense primes — from the first gap analysis to the after-action that proves it works.',buttons:[{text:'Request a briefing',link:'#contact'},{text:'See capabilities',link:'#capabilities'}],media:[asMedia(mediaByGroup('team',1))]},
 text:{pretitle:'THE DIFFERENCE',title:'Most continuity plans are written to pass an audit.',body:'Ours are written to survive the day the audit was imagining. That difference appears under exercise, when a plan meets the people who have to use it.',secondary:'Every section earns its place: orient, prove, explain, or convert.'},
 logo:{pretitle:'TRUSTED IN HIGH-CONSEQUENCE ENVIRONMENTS',title:'Built for teams that cannot improvise the basics.',body:'A restrained proof band gives the page authority without inventing client claims.',logos:['FEDERAL','DEFENSE','OPERATIONS','RESILIENCE','READINESS','MISSION']},
 stats:{pretitle:'READINESS, MADE VISIBLE',title:'A program should leave evidence behind.',body:'These are demonstration metrics for the concept preview, not factual client claims.',items:[{value:'01',label:'Decision path',description:'A clear first-hour sequence.'},{value:'04',label:'Core mandates',description:'Scoped against the real gap.'},{value:'90m',label:'Response window',description:'The plan must become action.'},{value:'100%',label:'Hand-off ready',description:'Built to operate without us.'}]},
 split:{pretitle:'WHERE PLANNING MEETS GROUND',title:'The plan is only useful when people can move through it.',subtitle:'We turn policy language into decisions, roles and actions that hold under pressure.',body:'Governance, delegation, succession and communications are designed together, then tested as one operating system.',bullets:['Decision-ready outputs','Exercises designed to find failure','A clean handover to the internal team'],buttons:[{text:'How we work',link:'#process'}],media:[asMedia(mediaByGroup('professional-services',2))]},
 cards:{pretitle:'CAPABILITIES',title:'Four mandates, composed as one program.',body:'Use cards when the reader needs to scan distinct offers, not because every homepage needs a grid.',items:[{title:'Program stand-up',text:'Governance, delegations, succession and the maintenance that keeps them current.'},{title:'Decision-ready outputs',text:'Documents a principal can act from in the first hour.'},{title:'Validation and exercises',text:'Tabletop through full-scale, designed to find the failure.'},{title:'Teaming and partnership',text:'Prime or sub, with the right scope named up front.'}]},
 tabs:{pretitle:'ONE PROGRAM, MULTIPLE WORKSTREAMS',title:'Explore the work without making the page longer.',subtitle:'Tabs are used because each panel contains substantial, parallel information.',items:[{title:'Stand-up',heading:'Establish the operating system',body:'Build the governance, roles and recurring maintenance cycle.',bullets:['Program charter','Delegations and succession','Annual maintenance cadence'],media:asMedia(mediaAt(3))},{title:'Exercise',heading:'Test the plan under pressure',body:'Design scenarios that expose the real dependency chain.',bullets:['Tabletop to full-scale','Injects tied to decisions','After-action ownership'],media:asMedia(mediaByGroup('problem',7))},{title:'Sustain',heading:'Keep it current and usable',body:'Turn every lesson into a controlled update, not another document pile.',bullets:['Version control','Training and onboarding','Evidence for review'],media:asMedia(mediaAt(6))}]},
 timeline:{pretitle:'THE OPERATING RHYTHM',title:'A sequence that moves from ambiguity to proof.',body:'A vertical timeline is the registered DST device for a real sequence.',items:[{value:'01',title:'Find the actual gap',text:'Interview, inventory and map the decision chain.'},{value:'02',title:'Build the usable plan',text:'Put first-hour choices in front of the annexes.'},{value:'03',title:'Exercise the weak points',text:'Test people, dependencies and communications.'},{value:'04',title:'Close the loop',text:'Assign owners, update the program and hand it over.'}],buttons:[{text:'Discuss your program',link:'#contact'}],media:[asMedia(mediaAt(0))]},
 testimonial:{pretitle:'PROOF, WITHOUT THE THEATER',title:'The strongest signal is a team that can use the work.',items:[{title:'Programme Director',pretitle:'Federal readiness programme · demonstration',text:'They made the plan feel less like compliance and more like an operating advantage. The exercise found the issue before the issue found us.',media:asMedia(mediaAt(14))},{title:'Operations Lead',pretitle:'Defense partner · demonstration',text:'The work was precise, practical and built around the decisions people would actually need to make under pressure.',media:asMedia(mediaAt(15))},{title:'Continuity Manager',pretitle:'Enterprise programme · demonstration',text:'We left with a system our internal team could run, not a binder that required the vendor to explain it.',media:asMedia(mediaAt(16))},{title:'Head of Resilience',pretitle:'Critical infrastructure operator · demonstration',text:'Two exercises in, the hand-offs that used to stall for a day were resolving inside the hour. That is the whole argument.',media:asMedia(mediaAt(17))}]},
 cta:{pretitle:'READY WHEN THE PLAN IS NOT',title:'Build a continuity program people can actually run.',subtitle:'Bring the current plan, the current problem, or the empty folder. We will start with the real gap.',buttons:[{text:'Request a briefing',link:'#contact'},{text:'Download capability statement',link:'#'}],media:[asMedia(mediaAt(5))]},
 faq:{pretitle:'COMMON QUESTIONS',title:'Clear answers before the first call.',items:[{title:'Can the program start from an incomplete plan?',text:'Yes. The first step is to identify what is usable, what is missing and which decisions matter first.'},{title:'Do you support exercises as well as planning?',text:'Yes. Every major output should have a matching validation or exercise path.'},{title:'Can this be handed over to an internal team?',text:'That is the goal. A program that permanently depends on the vendor is not finished.'}]},
 slider:{pretitle:'SELECTED WORK',title:'A visual sequence with a real reason to slide.',subtitle:'Use a slider for comparative or episodic content, never to hide essential copy.',items:[{title:'Assess',text:'Map the real operating conditions.',media:asMedia(mediaByGroup('problem',7))},{title:'Design',text:'Make decisions visible and usable.',media:asMedia(mediaByGroup('generic',0))},{title:'Exercise',text:'Find the failure while it is still inexpensive.',media:asMedia(mediaByGroup('team',1))},{title:'Sustain',text:'Keep the program current.',media:asMedia(mediaByGroup('professional-services',2))}]},
 pricing:{pretitle:'ENGAGEMENT MODELS',title:'Choose the right level of support.',body:'Demonstration packages for layout only. Replace with the real commercial model.',items:[{title:'Assess',price:'Fixed scope',text:'A focused readiness and gap assessment.',features:['Stakeholder interviews','Current-state review','Prioritized roadmap']},{title:'Build',price:'Programme',text:'Stand up or reconstruct the operating system.',features:['Governance and plans','Exercises and training','Controlled handover']},{title:'Sustain',price:'Retainer',text:'Keep the program current across the year.',features:['Quarterly maintenance','Annual exercise','Leadership reporting']}]},
 gallery:{pretitle:'THE WORK',title:'Evidence should carry the middle of the page.',body:'A gallery is a composition, not a pile of identical cards.',items:[0,1,2,8,9,10].map((i,n)=>({title:['Planning room','Working session','Programme review','Field readiness','Operational view','System detail'][n],media:asMedia(mediaAt(i))}))},
 contact:{pretitle:'START WITH THE REAL GAP',title:'Tell us what has to work when the normal path does not.',body:'The standalone preview reserves the Gravity Forms slot. WordPress owns the final form and submission behavior.',details:[{value:'01',title:'Share the current state',text:'Plan, problem or empty folder.'},{value:'02',title:'Name the decision window',text:'What must happen first?'},{value:'03',title:'Set the proof standard',text:'How will readiness be demonstrated?'}]},
 blog:{pretitle:'FIELD NOTES',title:'Useful thinking for continuity leaders.',items:[{title:'Why the first page matters more than the annexes',text:'Designing for the first hour.'},{title:'An exercise is not a performance',text:'How to build scenarios that teach.'},{title:'The handover test',text:'Could the internal team run it tomorrow?'}]},
 team:{pretitle:'THE PEOPLE IN THE PLAN',title:'Named expertise, not a bench swap.',items:[{title:'Programme Lead',text:'Governance and executive decision paths.',media:asMedia(mediaAt(14))},{title:'Exercise Director',text:'Scenario design and after-action ownership.',media:asMedia(mediaAt(15))},{title:'Continuity Analyst',text:'Dependencies, records and controlled updates.',media:asMedia(mediaAt(16))}]},
 accordion:{pretitle:'DETAIL, ON DEMAND',title:'Make complexity easier to scan.',items:[{title:'Governance and ownership',text:'Who owns the programme, the plan and every corrective action.'},{title:'Plans and decision aids',text:'What leaders need first, with the annexes behind it.'},{title:'Exercises and evidence',text:'How the programme proves it works and learns.'}]},
 haccordion:{pretitle:'A DIFFERENT WAY TO BROWSE',title:'Parallel stories in a horizontal device.',items:[{title:'Understand',text:'Map the operating context.'},{title:'Decide',text:'Make the critical choices visible.'},{title:'Practice',text:'Exercise the weak points.'},{title:'Improve',text:'Close the loop.'}]}
};

const FAMILY_USAGE={hero:'home-hero hook',text:'why differentiation value proposition',logo:'credibility trust credential-row',stats:'proof stats results counters',split:'offer services capabilities solution',cards:'offer services capabilities',tabs:'offer capabilities solutions',timeline:'process steps how-it-works',testimonial:'proof testimonial reviews',faq:'objections faq guarantee',cta:'conversion cta contact lead',slider:'proof portfolio slider',pricing:'offer pricing comparison',gallery:'proof portfolio gallery',contact:'conversion contact lead form',blog:'resources content',team:'credibility people',accordion:'objections faq',haccordion:'process parallel stories'};
const SECTION_PRESETS={
 hero:{container:'full',paddingTop:'none',paddingBottom:'none',inverted:true,viewport:'animate-headings'},
 text:{container:'alt',paddingTop:'large',paddingBottom:'large',inverted:false,viewport:'fade-up'},
 logo:{container:'wide',paddingTop:'small',paddingBottom:'small',inverted:true,viewport:'fade-up',decoration:{motif:'crosshatch',position:'cover',opacity:.08,scale:1}},
 stats:{container:'default',paddingTop:'default',paddingBottom:'default',inverted:false,viewport:'fade-up'},
 split:{container:'alt',paddingTop:'large',paddingBottom:'large',inverted:false,viewport:'fade-up'},
 cards:{container:'wide',paddingTop:'default',paddingBottom:'default',inverted:false,viewport:'fade-in-seq'},
 tabs:{container:'wide',paddingTop:'large',paddingBottom:'large',inverted:false,viewport:'fade-up',decoration:{motif:'tick-scale',position:'right',opacity:.1,scale:.85}},
 timeline:{container:'default',paddingTop:'large',paddingBottom:'large',inverted:true,viewport:'fade-up',decoration:{motif:'tick-scale',position:'left',opacity:.1,scale:.9}},
 testimonial:{container:'wide',paddingTop:'large',paddingBottom:'large',inverted:false,viewport:'fade-up'},
 faq:{container:'alt',paddingTop:'large',paddingBottom:'large',inverted:false,viewport:'fade-up'},
 cta:{container:'full',paddingTop:'none',paddingBottom:'none',inverted:true,viewport:'fade-up',decoration:{motif:'tick-scale',position:'right',opacity:.1,scale:.9}},
 slider:{container:'wide',paddingTop:'large',paddingBottom:'large',inverted:false,viewport:'fade-up'},
 pricing:{container:'wide',paddingTop:'large',paddingBottom:'large',inverted:false,viewport:'fade-up'},
 gallery:{container:'wide',paddingTop:'large',paddingBottom:'large',inverted:false,viewport:'fade-up'},
 contact:{container:'default',paddingTop:'large',paddingBottom:'large',inverted:true,viewport:'fade-up'},
 blog:{container:'wide',paddingTop:'large',paddingBottom:'large',inverted:false,viewport:'fade-up'},
 team:{container:'wide',paddingTop:'large',paddingBottom:'large',inverted:false,viewport:'fade-up'},
 accordion:{container:'alt',paddingTop:'large',paddingBottom:'large',inverted:false,viewport:'fade-up'},
 haccordion:{container:'wide',paddingTop:'large',paddingBottom:'large',inverted:false,viewport:'fade-up'}
};
function contentFor(family,index=0){return deepClone(defaultCopy[family]||defaultCopy.text)}
function patternLabel(section){return patternMap.get(section.patternId)?.title||section.patternId}
function sectionTitle(section){return section.content?.title||section.content?.pretitle||familyLabels[section.family]||section.family}
function sectionPreset(family,index=0){const base=SECTION_PRESETS[family]||{container:index%3===0?'wide':'default',paddingTop:'default',paddingBottom:'default',inverted:false,viewport:'fade-up'};return deepClone(base)}
function createSection(family,index=0,patternId=null){const pattern=patternFor(patternId||DATA.defaultPatternByFamily[family],family);const node=deepClone(pattern.tree);const id=uid(`section-${family}`),preset=sectionPreset(family,index);rekeyTree(node,id);node.pattern=pattern.id;node.role=family;node.usage=FAMILY_USAGE[family]||node.usage||'section';node.patternMeta={family:pattern.family,category:pattern.category,title:pattern.title,look:pattern.look};const section={id,family,patternId:pattern.id,visible:true,node,content:contentFor(family,index),layout:{container:preset.container,paddingTop:preset.paddingTop,paddingBottom:preset.paddingBottom,inverted:!!preset.inverted,background:'auto'},effects:{viewport:preset.viewport||'fade-up',scroll:preset.scroll||'',repeat:false},decoration:preset.decoration||null};syncSectionNode(section);return section}
function makeProject(){const flow=FLOW_CATALOG.find(f=>f.id==='B3')||FLOW_CATALOG[0];const sections=flow.families.map((f,i)=>createSection(f,i));return {id:uid('concept'),client:'Vision Continuity',brief:{projectName:'Vision Continuity',clientName:'Vision Continuity',industry:'Federal continuity & defense services',audience:'Federal programme leaders, defense primes and operational decision-makers',goal:'Generate qualified briefing requests while proving readiness expertise',offer:'Continuity programme stand-up, validation, exercises and sustainment',tone:'Calm authority, precise, operational, never theatrical',keywords:'readiness, continuity, decision-ready, exercised, handover',notes:'Demonstration concept. Replace proof points and testimonial content before publishing.'},design:{archetype:'A',styleSource:'archetype',palette:{bg:'#F7F5EF',ink:'#0A2536',accent:'#B5412B',soft:'#DCE4E7',dark:'#071C2A'},fontBody:'Inter',fontDisplay:'Cormorant Garamond',radius:'2px',density:48,expressiveness:63,motion:42,styleDNA:{schemaVersion:'sbs-style-dna/1.0',status:'empty',active:false,model:'kimi-k3:cloud',fallbackArchetype:'A',sources:[],synthesized:null,applied:null,preview:null,preserved:{},overrides:{},errors:[]},themeOverrides:{},componentRecipes:{},generatedCssTokens:{}},flowId:flow.id,header:{variant:'standard',position:'sticky',announcement:'',logoText:'Vision Continuity',nav:[['Who we are','#about'],['Capabilities','#capabilities'],['Approach','#process'],['Resources','#resources']],cta:{text:'Request a briefing',link:'#contact'}},footer:{variant:'editorial',statement:'Readiness is demonstrated, not declared.',description:'Continuity planning, exercises and programme sustainment for high-consequence organizations.',columns:[{title:'Explore',menuLocation:'footer-menu',links:[['Capabilities','#capabilities'],['Approach','#process'],['Resources','#resources']]},{title:'Company',menuLocation:'company-menu',links:[['Who we are','#about'],['Contact','#contact'],['Privacy','#privacy']]}],legal:'Vision Continuity · Demonstration concept'},sections};}
const SBS_STORAGE_KEY='sbs-builder-v3';
const SBS_LEGACY_STORAGE_KEYS=['sbs-dst-page-builder-v2','sbs-dst-page-builder-v1'];
const SBS_SESSION_SCHEMA='sbs-builder-session/3.0';
let saved=null;
try{
  saved=safeJson(localStorage.getItem(SBS_STORAGE_KEY));
  for(var sbsKeyIndex=0;!saved&&sbsKeyIndex<SBS_LEGACY_STORAGE_KEYS.length;sbsKeyIndex++){
    saved=safeJson(localStorage.getItem(SBS_LEGACY_STORAGE_KEYS[sbsKeyIndex]));
  }
}catch(e){saved=null}
/**
 * Whether a stored project can be bound at all.
 *
 * A 3.0 project keeps its page inside `conceptSet`; a 2.x project keeps it on the
 * project itself. Either shape is loadable — only one with neither is discarded,
 * because a project whose page is structurally impossible would throw on the
 * first render and leave the editor behind a blank screen.
 */
function sbsStoredProjectIsUsable(project){
  if(!project||typeof project!=='object')return false;
  var set=project.conceptSet;
  if(set&&set.concepts&&typeof set.concepts==='object'){
    return CONCEPT_IDS.some(function(id){return set.concepts[id]&&Array.isArray(set.concepts[id].sections)});
  }
  return Array.isArray(project.sections);
}
// A saved project whose section list is not an array would throw on the first
// render and leave the editor permanently broken behind a blank screen. An
// empty array is legitimate — a project can be saved with no modules yet — so
// only a structurally impossible value is discarded.
if(saved&&saved.project&&!sbsStoredProjectIsUsable(saved.project)){
  saved={...saved,project:null};
}
let state={project:saved?.project||makeProject(),currentStep:saved?.currentStep||0,selectedSectionId:saved?.selectedSectionId||null,device:saved?.device||'desktop',zoom:saved?.zoom??0,editorTab:'content',patternFilter:'all',dirty:false};
/*
 * The project becomes a live view of its active concept workspace.
 *
 * `migrateProject` brings a project of any earlier shape up to the concept-set
 * model and installs accessors for `design`, `sections`, `header`, `footer`,
 * `flowId`, `page`, `style` and `manualOverrides`. Every one of those resolves
 * through `conceptSet.activeConceptId` on each read and each write, so the five
 * thousand lines below this point edit the active concept and nothing else — and
 * there is no moment at which an edit exists on the project but not yet in a
 * concept. That is what replaced capture-on-switch.
 */
const conceptMigration=migrateProject(state.project,{resolveConceptDesign:sbsLegacyConceptDesign});
if(saved&&saved.activeConceptId)setActiveConcept(state.project,saved.activeConceptId);
if(!state.selectedSectionId)state.selectedSectionId=state.project.sections[0]?.id||null;
let saveTimer=null,previewTimer=null,inputHistoryTimer=null;
/** Resolves a 2.2.x concept descriptor against the archetype catalogue. */
function sbsLegacyConceptDesign(concept,options){
  return resolveConceptDesign(concept,{
    archetypeStyle:DATA.archetypeStyles[concept&&concept.archetypeKey],
    current:(options&&options.current)||{}
  });
}
/**
 * Undo and redo are per concept.
 *
 * Editing V1's headline, switching to V2, editing V2's cards and pressing undo
 * must undo the card change. A single project-wide stack cannot promise that, so
 * each concept keeps its own and switching concepts is not an edit.
 */
const conceptHistory=createConceptHistory({limit:40,onRestore:function(){sbsAfterConceptRestore()}});
function sbsAfterConceptRestore(){
  // The shared slices come back as fresh objects, so the accessor that puts
  // media placements on the active concept has to be reinstalled.
  bindProject(state.project);
  if(!state.project.sections.some(function(s){return s.id===state.selectedSectionId})){
    state.selectedSectionId=state.project.sections[0]?state.project.sections[0].id:null;
  }
  sbsSyncSimpleActive();
}
function checkpoint(){conceptHistory.checkpoint(state.project);updateUndoButtons()}
function undo(){if(!conceptHistory.undo(state.project))return;renderAll();queueSave();updateUndoButtons();announce('Undid last change in '+sbsActiveConceptLabel())}
function redo(){if(!conceptHistory.redo(state.project))return;renderAll();queueSave();updateUndoButtons();announce('Redid change in '+sbsActiveConceptLabel())}
function updateUndoButtons(){byId('undoBtn').disabled=!conceptHistory.canUndo(state.project);byId('redoBtn').disabled=!conceptHistory.canRedo(state.project)}
/** The active concept, named the way a strategist refers to it. */
function sbsActiveConceptLabel(){
  var concept=getActiveConcept(state.project);
  return concept?(concept.slot+' · '+concept.name):'this concept';
}
/**
 * Keeps the simple builder's concept cards pointing at the live concept.
 *
 * `simple.concepts` is the record of what the brain proposed; the concept set is
 * the live workspace. Only the selected index needs to agree between them.
 */
function sbsSyncSimpleActive(){
  var simple=state.project.simple;
  if(!simple||!Array.isArray(simple.concepts)||!simple.concepts.length)return;
  var index=conceptIndexOf(getActiveConceptId(state.project));
  if(index>=0&&index<simple.concepts.length&&simple.active!==null)simple.active=index;
}
/**
 * Autosave.
 *
 * `serializeProject` writes the concept set once. The mirrored active-concept
 * keys are enumerable so existing code keeps working, which also means a plain
 * `JSON.stringify` would store the live website twice — once inside its concept
 * and once beside it, with only one of the two having an owner.
 */
/**
 * The save pill.
 *
 * 'saving' shows immediately and stays up while the debounce is pending;
 * 'saved' replaces it and then withdraws, so a run of keystrokes reads as one
 * continuous save rather than a flicker per character. Hiding is on its own
 * timer because the pill has to survive the next keystroke arriving.
 */
var savePillTimer=null;
function savePill(phase){
  var pill=byId('saveStatus');
  if(!pill)return;
  clearTimeout(savePillTimer);
  pill.hidden=false;
  pill.textContent=phase==='saving'?'Saving':'Saved';
  pill.classList.toggle('is-saving',phase==='saving');
  // A frame, so the transition has a start state to move from on first show.
  requestAnimationFrame(function(){pill.classList.add('is-visible')});
  if(phase==='saved'){
    savePillTimer=setTimeout(function(){
      pill.classList.remove('is-visible');
      setTimeout(function(){if(!pill.classList.contains('is-visible'))pill.hidden=true},260);
    },1500);
  }
}
/** The session payload. One shape, written by the debounce and by the flush. */
function sessionPayload(){return {schemaVersion:SBS_SESSION_SCHEMA,project:serializeProject(state.project),currentStep:state.currentStep,selectedSectionId:state.selectedSectionId,activeConceptId:getActiveConceptId(state.project),device:state.device,zoom:state.zoom,moduleView:state.moduleView,builderMode:state.builderMode}}
function writeSession(){try{localStorage.setItem(SBS_STORAGE_KEY,JSON.stringify(sessionPayload()))}catch(e){}state.dirty=false}
function queueSave(){state.dirty=true;savePill('saving');clearTimeout(saveTimer);saveTimer=setTimeout(()=>{writeSession();savePill('saved')},420)}
/**
 * Writes a pending save immediately.
 *
 * The debounce is 420ms, which is the right interval for a run of keystrokes and
 * the wrong one for a page that is about to go away: close the tab, reload, or
 * switch to another app within that window and the last edit was simply lost.
 * `pagehide` is the event that fires in every case a document is discarded,
 * including the back/forward cache; `visibilitychange` covers a phone being
 * locked, where `pagehide` may never come.
 */
function flushSave(){
  if(!state.dirty)return;
  clearTimeout(saveTimer);
  saveTimer=null;
  writeSession();
}
window.addEventListener('pagehide',flushSave);
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')flushSave()});
function mutate(fn,{render=true,history=true,message=''}={}){if(history)checkpoint();fn();state.project.sections.forEach(syncSectionNode);
  // A deep edit — a headline, a pattern swap, a mobile column count — does not
  // pass through the slice setters, so the revision is stamped here. Publishing
  // compares it against the revision that was last snapshotted.
  touchConcept(getActiveConcept(state.project));
  queueSave();if(render)renderAll();else queuePreview();if(message)announce(message)}
function ensureParagraph(heading,text){let simple=(heading.children||[]).find(n=>n.component==='ds-blocks/simple-text');if(!simple){simple={id:uid('simple-text'),component:'ds-blocks/simple-text',usage:'rich-text',confidence:'confirmed',attributes:{},children:[]};heading.children=heading.children||[];heading.children.unshift(simple)}let p=(simple.children||[]).find(n=>n.component==='core/paragraph');if(!p){p={id:uid('paragraph'),component:'core/paragraph',usage:'paragraph',confidence:'confirmed',attributes:{},children:[]};simple.children=simple.children||[];simple.children.push(p)}p.attributes.content=text||''}
function inlineCheckIcon(label='Check'){const svg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg>';return {intent:'intent:inline-svg:'+encodeURIComponent(JSON.stringify({svg,label})),caption:label}}
function inlineQuoteIcon(label='Quotation mark'){const svg='<svg viewBox="0 0 32 24" xmlns="http://www.w3.org/2000/svg"><path fill="#B5412B" d="M0 24V13.2C0 5.9 4.2 1.1 12 0v4.6C7.6 5.6 5.4 8.2 5.4 12.2H12V24H0Zm20 0V13.2C20 5.9 24.2 1.1 32 0v4.6c-4.4 1-6.6 3.6-6.6 7.6H32V24H20Z"/></svg>';return {intent:'intent:inline-svg:'+encodeURIComponent(JSON.stringify({svg,label})),caption:label}}
function cardNode(item,index,section){const media=item.media||mediaChoice(section,index),attributes={pretitle:item.pretitle||'',title:item.title||`Item ${index+1}`,description:item.text||item.body||'',media,button:item.button||null};
  // c-card-item is the one registered component with first-class video, so a
  // clip on a card is expressed the way DST expects rather than as a still.
  if(isVideoMedia(media)){attributes.mediaType='video';attributes.video={id:0,url:media.src};attributes.videoAutoplay=true;attributes.playOnHover=false}
  return {id:`${section.id}-generated-card-${index+1}`,component:'ds-blocks/c-card-item',usage:section.family==='testimonial'?'testimonial-card':'card',confidence:'confirmed',attributes,children:[]}}
function listNode(item,index,section,{withIcon=true,themeIcon=''}={}){const hasHero=item.value!=null&&String(item.value)!=='';const attrs={iconDisplay:'inline',heroText:hasHero?String(item.value):'',listTitle:item.title||item.label||`Item ${index+1}`,listSubTitle:item.text||item.description||''};if(!hasHero&&withIcon)attrs.icon=themeIcon||item.icon||inlineCheckIcon('Check');return {id:`${section.id}-generated-list-${index+1}`,component:'ds-blocks/c-list-item',usage:'list-item',confidence:'confirmed',attributes:attrs,children:[]}}
function syncHeading(node,content,{titleOnly=false,level='h2'}={}){const a=node.attributes||(node.attributes={});a.backtitle=a.backtitle||'';a.pretitle=content.pretitle||'';a.title=content.title||'';a.subtitle=content.subtitle||'';a.showPretitle=!!content.pretitle;a.showTitle=content.title!=='';a.showSubtitle=!!content.subtitle;a.showDescription=!!(content.body||content.secondary);delete a.showText;delete a.showButtons;delete a.title_styles;a.titleTypography={...(a.titleTypography||{}),tag:level,preset:level==='h1'?'h1-style':level==='h3'?'h3-style':'h2-style'};if(content.body&&!titleOnly)ensureParagraph(node,content.body);if(content.alignment){a.alignment=content.alignment;a.alignmentMobile=content.alignmentMobile||content.alignment}}
function ensureLogoHeading(node,section){let h=firstNode(node,'ds-blocks/c-heading');if(h)return h;h={id:`${section.id}-logo-heading`,component:'ds-blocks/c-heading',usage:'section-header credibility',confidence:'confirmed',attributes:{backtitle:'',pretitle:'',title:'',subtitle:'',showPretitle:true,showTitle:true,showSubtitle:true,titleTypography:{tag:'h2',preset:'h2-style'},alignment:'center',alignmentMobile:'center'},layout:{container:'full'},children:[]};node.children=node.children||[];node.children.unshift(h);return h}
function configureCardGrid(cards,section,items,{slider=false,columns=null}={}){cards.attributes=cards.attributes||{};const a=cards.attributes,desktop=columns||Math.min(4,Math.max(2,items.length||3));a.source='static';a.columnsDesktop=desktop;a.columnsTablet=Math.min(2,desktop);a.columnsMobile=1;a.gapVertical=a.gapVertical||'2.4rem';a.gapVerticalTablet=a.gapVerticalTablet||'2rem';a.gapVerticalMobile=a.gapVerticalMobile||'1.6rem';a.gapHorizontal=a.gapHorizontal||'2.4rem';a.gapHorizontalTablet=a.gapHorizontalTablet||'2rem';a.gapHorizontalMobile=a.gapHorizontalMobile||'1.6rem';a.cardItemPadding=a.cardItemPadding||{top:'2.8rem',right:'2.8rem',bottom:'2.8rem',left:'2.8rem'};a.cardItemPaddingTablet=deepClone(a.cardItemPadding);a.cardItemPaddingMobile={top:'2.2rem',right:'2.2rem',bottom:'2.2rem',left:'2.2rem'};a.bodyPadding=a.bodyPadding||{top:'0rem',right:'0rem',bottom:'0rem',left:'0rem'};a.bodyPaddingTablet=deepClone(a.bodyPadding);a.bodyPaddingMobile=deepClone(a.bodyPadding);a.enableBorder=true;a.cardBorder=a.cardBorder||{width:'1px',style:'solid',color:'var(--dst--border-color)'};a.enableDstSlider=!!slider;a.dstSliderSettings=slider?{showArrows:true,showProgress:true,bleedRight:true,bleedRightVisibleItems:Math.min(3,desktop),arrowsPosition:'bottom'}:{};cards.children=items.map((item,i)=>cardNode(item,i,section))}
function syncSectionNode(section){const node=section.node;if(!node)return;ensureSectionSettings(section);node.pattern=section.patternId;node.role=section.family;node.confidence='confirmed';node.usage=FAMILY_USAGE[section.family]||node.usage||'section';node.inverted=!!section.layout.inverted;node.layout={...(node.layout||{}),container:section.layout.container,padding:{top:section.layout.paddingTop,bottom:section.layout.paddingBottom}};node.dsEffects=section.effects?.scroll?{type:section.effects.scroll,mode:'scrub',fallback:section.effects.viewport||'fade-up',repeat:false,threashold:0,margin:'',custom:''}:{type:section.effects?.viewport||'fade-up',mode:'trigger',fallback:section.effects?.viewport||'fade-up',repeat:!!section.effects?.repeat,threashold:.15,margin:'',custom:''};if(section.decoration)node.decorations=[{...section.decoration,color:section.decoration.color||'primary-color2',rationale:'Builder-selected registered DST decoration'}];else delete node.decorations;
  const c=section.content||{};
  if(section.family==='logo')ensureLogoHeading(node,section);
  const headings=allNodes(node,'ds-blocks/c-heading');
  if(section.family==='text'&&headings.length>1){syncHeading(headings[0],{pretitle:c.pretitle,title:'',subtitle:''},{level:'h2',titleOnly:true});syncHeading(headings[1],{title:c.title,body:[c.body,c.secondary].filter(Boolean).join('\n\n')},{level:'h2'});headings[1].attributes.headingTheme='';}
  else if(headings[0])syncHeading(headings[0],c,{level:section.family==='hero'?'h1':'h2'});
  if(headings[0]){const accents={hero:{text:'holds',style:['italic','bold']},split:{text:'move through it',style:['highlight'],color:'secondary-color3'},cta:{text:'actually run',style:['italic','bold']}};if(accents[section.family])headings[0].titleAccents=[accents[section.family]];else if(section.family!=='text')delete headings[0].titleAccents}
  const groups=allNodes(node,'ds-blocks/button-group');groups.forEach(g=>{g.attributes=g.attributes||{};const center=section.family==='cta'||String(headings[0]?.attributes?.alignment||'').includes('center');g.attributes.justifyContent=center?'center':'flex-start';g.attributes.justifyContentMobile='center'});
  const buttons=allNodes(node,'ds-blocks/c-btn');buttons.forEach((button,i)=>{button.attributes=button.attributes||{};const b=(c.buttons||[])[i];if(b){button.attributes.text=b.text;button.attributes.link={url:normalizeLink(b.link)};button.attributes.btnType=i?'secondary':'primary';button.attributes.hasIcon=i===0;button.attributes.iconPosition='row-reverse'}else{button.attributes.text='';button.attributes.link={url:'#'}}});
  const bg=asMedia(c.media?.[0]||mediaAt(section.family==='cta'?5:1));if(node.component==='ds-blocks/dst-banner'){node.attributes=node.attributes||{};node.attributes.backgroundImage=bg;node.attributes.backgroundOverlayEnabled=true;node.attributes.backgroundOverlay=section.family==='cta'?'linear-gradient(90deg,var(--dst--primary-color1),rgba(7,28,42,.44))':'linear-gradient(90deg,var(--dst--primary-color1) 0%,rgba(7,28,42,.82) 48%,rgba(7,28,42,.18) 100%)';node.attributes.backgroundOverlayOpacity=1;node.attributes.bannerHeight=section.family==='hero'?'full':'auto';node.attributes.bannerTabletHeight='auto';node.attributes.bannerMobileHeight='auto';node.attributes.showScrollDown=section.family==='hero';node.attributes.innerContainerWidth='container';node.attributes.horizontalAlign=section.family==='cta'?'center':'left';node.attributes.horizontalAlignMobile='center'}
  // The banner already claimed media[0] as its background; a foreground visual
  // that reads the same index would repeat the picture on top of itself.
  const mediaOffset=node.component==='ds-blocks/dst-banner'?1:0;
  const content2=allNodes(node,'ds-blocks/l-content-2');content2.forEach((n,i)=>{n.attributes=n.attributes||{};n.attributes.media=asMedia(c.media?.[i+mediaOffset]||c.media?.[mediaOffset]||mediaAt(i+2));n.attributes.columnsOrder=(section.family==='timeline'||i%2)?'order-reverse':'order-default';n.attributes.columnsOrderMobile='order-reverse-mobile';delete n.attributes.mediaPosition});
  // A c-media node shows an item's picture when the section has items, and the
  // section's own ordered media when it does not. Both readings have to line up
  // with the slot list the imagery job is given, or an assigned picture would be
  // stored and never rendered.
  const medias=allNodes(node,'ds-blocks/c-media'),mediaBase=mediaOffset+content2.length;
  medias.forEach((n,i)=>{n.attributes=n.attributes||{};n.attributes.media=(c.items?.[i]?.media)||c.media?.[mediaBase+i]||mediaChoice(section,i+3);delete n.attributes.alt});
  if(CARD_MEDIA_FAMILIES.includes(section.family)){const cards=firstNode(node,'ds-blocks/c-cards');if(cards)configureCardGrid(cards,section,c.items||[],{slider:section.family==='slider',columns:section.family==='gallery'?3:null})}
  if(section.family==='testimonial'){const cards=firstNode(node,'ds-blocks/c-cards');if(cards){configureCardGrid(cards,section,c.items||[],{slider:false,columns:1});cards.attributes.isHorizontal=true;cards.attributes.imageTextRatio='32%';cards.attributes.enableBorder=true}}
  if(section.family==='stats'||section.family==='timeline'){const list=firstNode(node,'ds-blocks/c-list');if(list){list.attributes=list.attributes||{};list.attributes.showIcons=false;list.attributes.showHeroText=true;list.attributes.heroIsCounter=section.family==='stats';list.attributes.colCount=section.family==='stats'?4:1;list.attributes.colCountTablet=section.family==='stats'?2:1;list.attributes.colCountMobile=1;list.attributes.layoutVariant='grid';list.attributes.enableTimeline=section.family==='timeline';list.attributes.colorIcon='var(--dst--primary-color2)';list.attributes.iconsSize='2.4rem';list.children=(c.items||[]).map((item,i)=>listNode(item,i,section,{withIcon:false}))}}
  if(section.family==='split'){const list=firstNode(node,'ds-blocks/c-list');if(list){list.attributes=list.attributes||{};list.attributes.showIcons=true;list.attributes.showHeroText=false;list.attributes.colorIcon='var(--dst--primary-color2)';list.attributes.iconsSize='2.2rem';list.children=(c.bullets||[]).map((text,i)=>listNode({title:text,text:''},i,section))}}
  if(section.family==='contact'){const list=firstNode(node,'ds-blocks/c-list');if(list){list.attributes=list.attributes||{};list.attributes.showIcons=false;list.attributes.showHeroText=true;list.children=(c.details||[]).map((item,i)=>listNode(item,i,section,{withIcon:false}))}if(!firstNode(node,'gravityforms/form')){let target=firstNode(node,'ds-blocks/ds-column')||node;target.children=target.children||[];target.children.push({id:`${section.id}-form-slot`,component:'gravityforms/form',usage:'form-slot',confidence:'confirmed',attributes:{formId:0,title:false,description:false,ajax:true,placeholder:'Gravity Forms slot — assign the production form in WordPress'},children:[]})}}
  if(section.family==='tabs'){const tabs=firstNode(node,'ds-blocks/ds-tabs');if(tabs){tabs.attributes=tabs.attributes||{};tabs.attributes.tabItem={};const existing=tabs.children||[];const template=existing[0]||{id:uid('tab'),component:'ds-blocks/ds-tab',usage:'tab',confidence:'confirmed',attributes:{currentBlockIndex:1},children:[]};tabs.children=(c.items||[]).map((item,i)=>{const tab=deepClone(existing[i]||template);rekeyTree(tab,`${section.id}-tab-${i+1}`);tab.attributes=tab.attributes||{};tab.attributes.currentBlockIndex=i+1;tabs.attributes.tabItem[String(i+1)]={content:item.title,iconLayout:'none'};const h=firstNode(tab,'ds-blocks/c-heading');if(h){syncHeading(h,{pretitle:item.title,title:item.heading||item.title,subtitle:item.body,body:item.body},{level:'h3'});const l=firstNode(h,'ds-blocks/c-list');if(l){l.attributes=l.attributes||{};l.attributes.showIcons=true;l.attributes.showHeroText=false;l.attributes.colorIcon='var(--dst--primary-color2)';l.attributes.iconsSize='2rem';l.children=(item.bullets||[]).map((text,j)=>listNode({title:text},j,section))}}const m=firstNode(tab,'ds-blocks/c-media');if(m){m.attributes=m.attributes||{};m.attributes.media=item.media||mediaChoice(section,i+4);delete m.attributes.alt}stripComponents(tab,new Set(['ds-blocks/c-list']));return tab})}}
  if(section.family==='faq'||section.family==='accordion'){const acc=firstNode(node,'ds-blocks/c-accordion');if(acc){acc.attributes=acc.attributes||{};acc.attributes.dataSource='static';acc.attributes.faqIds=[];acc.attributes.faqItems=[];const embeddedHeading=(acc.children||[]).find(n=>n.component==='ds-blocks/c-heading');if(embeddedHeading&&node.component==='ds-blocks/dst-wrapper'){acc.children=(acc.children||[]).filter(n=>n!==embeddedHeading);node.children=(node.children||[]).filter(n=>n!==embeddedHeading);node.children.unshift(embeddedHeading)}acc.children=(c.items||[]).map((item,i)=>({id:`${section.id}-accordion-${i+1}`,component:'ds-blocks/c-accordion-item',usage:'accordion-item objections',confidence:'confirmed',attributes:{title:item.title,defaultOpen:i===0},children:[{id:`${section.id}-accordion-answer-${i+1}`,component:'core/paragraph',usage:'answer',confidence:'confirmed',attributes:{content:item.text},children:[]}]}))}}
  if(section.family==='haccordion'){const hacc=firstNode(node,'ds-blocks/dst-hacc');if(hacc)hacc.children=(c.items||[]).map((item,i)=>({id:`${section.id}-hacc-${i+1}`,component:'ds-blocks/dst-hacc-item',usage:'horizontal-accordion-item process',confidence:'confirmed',attributes:{title:item.title,description:item.text,media:item.media||mediaChoice(section,i+5)},children:[]}))}
  if(section.family==='logo'){const list=firstNode(node,'ds-blocks/c-list');if(list){list.attributes=list.attributes||{};list.attributes.showIcons=true;list.attributes.showTitle=true;list.attributes.showSubtitle=false;list.attributes.showHeroText=false;list.attributes.layoutVariant='flex';list.attributes.alignment='row';list.attributes.flexJustify='center';list.attributes.flexAlign='center';list.attributes.colCount=Math.min(6,c.logos?.length||6);list.attributes.colCountTablet=3;list.attributes.colCountMobile=2;list.attributes.iconsSize='2.2rem';list.attributes.colorIcon='var(--dst--secondary-color1)';const valid=['lib-icon-pin','lib-icon-mail','lib-icon-calendar','lib-icon-clock','lib-icon-arrow1','lib-icon-arrow2'];list.children=(c.logos||[]).map((label,i)=>listNode({title:label,text:''},i,section,{themeIcon:valid[i%valid.length]}))}}
  if(section.family==='pricing'){const columns=firstNode(node,'ds-blocks/ds-columns');if(columns){const template=columns.children?.[0]||{id:uid('column'),component:'ds-blocks/ds-column',usage:'column',confidence:'confirmed',attributes:{allowedBlocks:[],templateLock:false},children:[]};columns.children=(c.items||[]).map((plan,i)=>{const col=deepClone(template);rekeyTree(col,`${section.id}-plan-${i+1}`);col.attributes=col.attributes||{};col.attributes.backgroundColor=i===1?'var(--dst--primary-color1)':'var(--dst--secondary-color2)';const h=firstNode(col,'ds-blocks/c-heading');if(h){syncHeading(h,{pretitle:plan.price,title:plan.title,subtitle:plan.text},{level:'h3'});let list=firstNode(h,'core/list');if(list)list.children=(plan.features||[]).map((x,j)=>({id:`${section.id}-feature-${i}-${j}`,component:'core/list-item',usage:'list-item',confidence:'confirmed',attributes:{content:x},children:[]}));const btn=firstNode(h,'ds-blocks/c-btn');if(btn){btn.attributes.text='Choose '+plan.title;btn.attributes.link={url:'#contact'}}}return col})}}
  rekeyTree(node,section.id);
}
function field(label,path,value,{type='text',full=false,placeholder='',help='',rows=3,options=[]}={}){const cls=full?'field full':'field';let control='';if(type==='textarea')control=`<textarea data-bind="${escAttr(path)}" rows="${rows}" placeholder="${escAttr(placeholder)}">${esc(value)}</textarea>`;else if(type==='select')control=`<select data-bind="${escAttr(path)}">${options.map(o=>`<option value="${escAttr(o.value)}" ${String(o.value)===String(value)?'selected':''}>${esc(o.label)}</option>`).join('')}</select>`;else control=`<input type="${escAttr(type)}" data-bind="${escAttr(path)}" value="${escAttr(value)}" placeholder="${escAttr(placeholder)}">`;return `<div class="${cls}"><label>${label}</label>${control}${help?`<div class="field-help">${esc(help)}</div>`:''}</div>`}
/* ---------------------------------------------------------------- *
 * Sliders instead of typed numbers
 *
 * Nobody outside this repo knows that overlay strength is a 0–1 float, that a
 * blur is a CSS length, or that a gap is written in `rem`. They know "more" and
 * "less". So every numeric layout control is a slider that shows its value in
 * the unit a person would say out loud, and the storage format stays exactly
 * what the DST attribute expects.
 *
 * `scale` is how many slider steps make one stored unit — 100 for a 0–1 opacity,
 * 1 for a plain count. `unit` is the CSS suffix a stored *string* carries; when
 * it is set, an empty stored value means "not set" and slides back to zero.
 * ---------------------------------------------------------------- */

/** The slider position for a stored value. Anything unreadable falls back. */
function rangeSliderValue(value,{scale=1,unit='',fallback=0,min=0,max=100,step=1}={}){
  var raw=unit?parseFloat(String(value==null?'':value)):Number(value),
    number=Number.isFinite(raw)?raw*(unit?1:scale):fallback*(unit?1:scale);
  if(!Number.isFinite(number))number=0;
  var snapped=step&&step<1?Math.round(number/step)*step:Math.round(number);
  return clamp(Number(snapped.toFixed(4)),min,max);
}

/** What the slider says on screen: the unit a person would use, never a float. */
function rangeDisplay(sliderValue,{scale=1,unit='',display=''}={}){
  var n=Number(sliderValue);
  if(display==='percent'||(!display&&scale===100&&!unit))return Math.round(n)+'%';
  if(display)return (Number.isInteger(n)?n:Number(n.toFixed(2)))+display;
  if(unit)return (Number.isInteger(n)?n:Number(n.toFixed(2)))+unit;
  return String(Number.isInteger(n)?n:Number(n.toFixed(2)));
}

/**
 * The stored value for a slider position, in the format the attribute wants.
 *
 * `zeroEmpty` is the difference between "no blur" and "a blur of zero": an
 * optional effect stores nothing at zero so it is never emitted, while a real
 * measurement — a gap — stores `0rem`, because an empty gap would fall through
 * to the pattern's default and refuse to close.
 */
function rangeStoredValue(sliderValue,{scale=1,unit='',zeroEmpty=false}={}){
  var n=Number(sliderValue);
  if(!Number.isFinite(n))n=0;
  if(unit)return (!n&&zeroEmpty)?'':Number(n.toFixed(4))+unit;
  return String(Number((n/scale).toFixed(4)));
}

/**
 * A labelled slider bound to the same `data-bind` path any other field uses.
 * The conversion between slider position and stored value rides along on the
 * element, so one delegated listener serves every slider in the builder.
 */
function rangeField(label,path,value,options={}){
  var opts={scale:1,unit:'',display:'',min:0,max:100,step:1,fallback:0,full:true,help:'',zeroEmpty:false,...options},
    slider=rangeSliderValue(value,opts);
  return '<div class="field '+(opts.full?'full ':'')+'range-field"><label>'+esc(label)+' <output>'+esc(rangeDisplay(slider,opts))+'</output></label>'+
    '<input type="range" min="'+opts.min+'" max="'+opts.max+'" step="'+opts.step+'" value="'+slider+'"'+
      ' data-bind="'+escAttr(path)+'" data-range-scale="'+opts.scale+'" data-range-unit="'+escAttr(opts.unit)+'" data-range-display="'+escAttr(opts.display)+'"'+
      (opts.zeroEmpty?' data-range-zero-empty="1"':'')+'>'+
    (opts.help?'<div class="field-help">'+esc(opts.help)+'</div>':'')+'</div>';
}

/** Reads a slider's own conversion contract back off the element. */
function rangeOptionsFrom(input){
  return {
    scale:Number(input.dataset.rangeScale)||1,
    unit:input.dataset.rangeUnit||'',
    display:input.dataset.rangeDisplay||'',
    zeroEmpty:input.dataset.rangeZeroEmpty==='1'
  };
}

function panel(title,body,meta='',attrs=''){return `<section class="panel"${attrs?' '+attrs:''}><div class="panel-head"><h2>${title}</h2>${meta?`<small>${meta}</small>`:''}</div><div class="panel-body">${body}</div></section>`}
function pageHead(kicker,title,description,badge=''){return `<div class="page-head"><div class="eyebrow">${esc(kicker)}</div><div class="page-head-row"><div><h1>${title}</h1><p>${description}</p></div>${badge?`<span class="badge">${esc(badge)}</span>`:''}</div></div>`}
function renderStepNav(){byId('stepNav').innerHTML=STEPS.map((s,i)=>`<li><button class="step-btn ${i===state.currentStep?'active':''} ${i<state.currentStep?'done':''}" data-step="${i}"><span class="step-num">${i<state.currentStep?'✓':i+1}</span><span class="step-copy"><b>${esc(s.title)}</b><span>${esc(s.sub)}</span></span><span class="step-state"></span></button></li>`).join('')}
function renderEditorNav(){return `<div class="editor-nav"><button class="nav-btn" data-nav="prev" ${state.currentStep===0?'disabled':''}>← Previous</button><span class="nav-hint">Step ${state.currentStep+1} of ${STEPS.length}</span><button class="nav-btn next" data-nav="next">${state.currentStep===STEPS.length-1?'Back to brief':'Continue →'}</button></div>`}
function renderBrief(){const b=state.project.brief;return pageHead('01 · Brief','Start with the job of the page.','The builder uses this brief to keep content, flow and visual choices coherent. You are defining the argument before choosing modules.','Autosaved')+
 panel('Project essentials',`<div class="field-grid">${field('Project name','brief.projectName',b.projectName)}${field('Client / brand','brief.clientName',b.clientName)}${field('Industry / context','brief.industry',b.industry,{full:true})}${field('Primary audience','brief.audience',b.audience,{type:'textarea',rows:3})}${field('Primary page goal','brief.goal',b.goal,{type:'textarea',rows:3})}</div>`)+
 panel('Offer and voice',`<div class="field-grid">${field('Core offer','brief.offer',b.offer,{type:'textarea',rows:3})}${field('Voice and tone','brief.tone',b.tone,{type:'textarea',rows:3})}${field('Useful words / themes','brief.keywords',b.keywords,{full:true,help:'Used as a creative guardrail, not as keyword stuffing.'})}${field('Internal notes','brief.notes',b.notes,{type:'textarea',rows:3,full:true})}</div>`)+renderEditorNav()}
function renderDirection(){const d=state.project.design;const arch=DATA.archetypes[d.archetype]||{};const choices=Object.entries(DATA.archetypes).map(([key,a])=>`<button class="choice ${key===d.archetype?'selected':''}" data-archetype="${key}"><div class="choice-code">${key} · ${esc(a.polarity)}</div><b>${esc(a.name)}</b><p>${esc((a.notes||a.paletteIntent||'').slice(0,118))}</p></button>`).join('');const fonts=fontOptions();return pageHead('02 · Direction','Choose a visual system, not a skin.','Archetypes set polarity, typography, surface behavior and composition rules. Fine-tune the tokens without breaking the DST vocabulary.',`${d.archetype} · ${arch.name||'Custom'}`)+
 panel('DST visual archetype',`<div class="choice-grid">${choices}</div>`,'A–M')+
 panel('Palette and type',`<div class="panel-note">The five colors become semantic DST tokens: body, text, accent, supporting surface and inverted ground.</div><div class="palette-row">${[['bg','Canvas'],['ink','Ink'],['accent','Accent'],['soft','Soft'],['dark','Dark']].map(([k,l])=>`<label class="color-field"><input type="color" data-bind="design.palette.${k}" value="${escAttr(d.palette[k])}"><span>${l}</span></label>`).join('')}</div><div class="field-grid" style="margin-top:16px">${field('Body typeface','design.fontBody',d.fontBody,{type:'select',options:fonts})}${field('Display typeface','design.fontDisplay',d.fontDisplay,{type:'select',options:fonts})}${field('Corner language','design.radius',d.radius,{type:'select',full:true,options:[{value:'0px',label:'Square / editorial'},{value:'2px',label:'Almost square'},{value:'8px',label:'Soft utility'},{value:'16px',label:'Friendly rounded'},{value:'28px',label:'Expressive rounded'}]})}</div>`)+
 panel('Design dials',`<div class="range-row">${[['density','Density'],['expressiveness','Expression'],['motion','Motion']].map(([k,l])=>`<div class="range-field"><label>${l}<output>${d[k]}</output></label><input type="range" min="0" max="100" value="${d[k]}" data-bind="design.${k}"></div>`).join('')}</div>`)+renderEditorNav()}
function moduleRows(){return state.project.sections.map((s,i)=>`<div class="module-row ${s.id===state.selectedSectionId?'selected':''}" draggable="true" data-section-id="${s.id}"><span class="drag" title="Drag to reorder">${ICONS.grip}</span><span class="module-index">${String(i+1).padStart(2,'0')}</span><span class="module-copy"><b>${esc(familyLabels[s.family]||s.family)} · ${esc(sectionTitle(s))}</b><span>${esc(patternLabel(s))}</span></span><span class="module-actions"><button class="mini-btn" data-action="duplicate" data-id="${s.id}" title="Duplicate">${ICONS.copy}</button><button class="mini-btn danger" data-action="remove" data-id="${s.id}" title="Remove">${ICONS.trash}</button></span></div>`).join('')}
function renderFlow(){const flow=flowById(state.project.flowId)||FLOW_CATALOG[0];const flows=allFlows().map(f=>`<button class="flow-card ${f.id===state.project.flowId?'selected':''}" data-flow="${f.id}"><div class="flow-top"><span class="flow-id">${f.id}</span><b>${esc(f.name)}</b></div><p>${esc(f.tagline)}. ${esc(f.bestFor)}</p><div class="flow-family">${f.families.map(x=>`<span>${esc(x)}</span>`).join('')}</div></button>`).join('');return pageHead('03 · Page flow','Choose the argument, then shape the sequence.','Named SBS flows prevent the habitual “hero + cards + logo strip” solution. Select a structure, then reorder or replace any module.',`${flow.id} · ${flow.name}`)+
 panel('SBS flow library',`<div class="choice-grid">${flows}</div>`,'15 flows')+
 panel('Current page sequence',`<div class="panel-note"><b>${esc(flow.tagline)}</b><br>${esc(flow.rhythm)}</div><div id="moduleList" class="module-list">${moduleRows()}</div><button class="add-row" data-action="add-module" style="width:100%;margin-top:8px">+ Add a DST module</button>`,'Drag to reorder')+renderEditorNav()}
function repeatRows(section,items,type){if(!items?.length)return '<div class="empty-state"><b>No items yet</b><p>Add the first item for this module.</p></div>';if(type==='stats')return items.map((x,i)=>`<div class="repeat-row"><input data-item="${i}" data-key="value" value="${escAttr(x.value||'')}" placeholder="Value"><input data-item="${i}" data-key="label" value="${escAttr(x.label||x.title||'')}" placeholder="Label"><button class="mini-btn danger" data-remove-item="${i}">${ICONS.trash}</button></div><div class="repeat-row wide" style="margin-top:-3px"><input data-item="${i}" data-key="description" value="${escAttr(x.description||x.text||'')}" placeholder="Supporting description"><span></span></div>`).join('');if(type==='pricing')return items.map((x,i)=>`<div style="border:1px solid #e4e1da;padding:9px;margin-bottom:7px"><div class="repeat-row"><input data-item="${i}" data-key="title" value="${escAttr(x.title||'')}" placeholder="Plan"><input data-item="${i}" data-key="price" value="${escAttr(x.price||'')}" placeholder="Price / label"><button class="mini-btn danger" data-remove-item="${i}">${ICONS.trash}</button></div><div class="repeat-row wide" style="margin-top:6px"><input data-item="${i}" data-key="text" value="${escAttr(x.text||'')}" placeholder="Plan description"><span></span></div><div class="field-help" style="margin-top:6px">Features: ${esc((x.features||[]).join(' · '))}</div></div>`).join('');return items.map((x,i)=>`<div class="repeat-row"><input data-item="${i}" data-key="title" value="${escAttr(x.title||x.label||'')}" placeholder="Title"><input data-item="${i}" data-key="text" value="${escAttr(x.text||x.description||x.body||'')}" placeholder="Description"><button class="mini-btn danger" data-remove-item="${i}" title="Remove">${ICONS.trash}</button></div>`).join('')}
function commonContentFields(s,{subtitle=true,body=true}={}){const c=s.content;return `<div class="field-grid">${field('Pretitle / eyebrow',`section.${s.id}.pretitle`,c.pretitle||'',{full:true})}${field('Section title',`section.${s.id}.title`,c.title||'',{type:'textarea',rows:2,full:true})}${subtitle?field('Subtitle',`section.${s.id}.subtitle`,c.subtitle||'',{type:'textarea',rows:3,full:true}):''}${body?field('Body copy',`section.${s.id}.body`,c.body||'',{type:'textarea',rows:4,full:true}):''}</div>`}
function renderButtonsEditor(s){const items=s.content.buttons||[];return `<div class="repeater">${items.map((x,i)=>`<div class="repeat-row"><input data-button="${i}" data-key="text" value="${escAttr(x.text)}" placeholder="Button label"><input data-button="${i}" data-key="link" value="${escAttr(x.link)}" placeholder="#anchor or URL"><button class="mini-btn danger" data-remove-button="${i}">${ICONS.trash}</button></div>`).join('')}<button class="add-row" data-add-button>Add button</button></div>`}
function renderContentEditor(s){const c=s.content;let html='';if(s.family==='hero'||s.family==='cta'){html=commonContentFields(s,{subtitle:true,body:false})+`<h3 style="font-size:10px;margin:17px 0 8px">Calls to action</h3>${renderButtonsEditor(s)}`}
 else if(s.family==='text'){html=commonContentFields(s,{subtitle:false,body:true})+`<div class="field" style="margin-top:12px"><label>Supporting statement</label><textarea data-section-field="secondary" rows="3">${esc(c.secondary||'')}</textarea></div>`}
 else if(s.family==='logo'){html=commonContentFields(s,{subtitle:false,body:true})+`<div class="field" style="margin-top:12px"><label>Wordmarks <span>comma separated placeholders</span></label><input data-csv="logos" value="${escAttr((c.logos||[]).join(', '))}"></div>`}
 else if(s.family==='split'){html=commonContentFields(s,{subtitle:true,body:true})+`<div class="field" style="margin-top:12px"><label>Proof points <span>one per line</span></label><textarea data-lines="bullets" rows="4">${esc((c.bullets||[]).join('\n'))}</textarea></div><h3 style="font-size:10px;margin:17px 0 8px">Calls to action</h3>${renderButtonsEditor(s)}`}
 else if(s.family==='testimonial'){html=commonContentFields(s,{subtitle:false,body:false})+`<h3 style="font-size:10px;margin:17px 0 8px">Testimonials</h3><div class="repeater">${repeatRows(s,c.items)}<button class="add-row" data-add-item>Add testimonial</button></div><div class="field-help" style="margin-top:8px">Use the item title for the person or role, and the description for the quote. Demonstration copy is labeled in the preview.</div>`}
 else if(s.family==='faq'||s.family==='accordion'||s.family==='haccordion'){html=commonContentFields(s,{subtitle:false,body:false})+`<h3 style="font-size:10px;margin:17px 0 8px">Items</h3><div class="repeater">${repeatRows(s,c.items)}<button class="add-row" data-add-item>Add item</button></div>`}
 else if(s.family==='stats'){html=commonContentFields(s,{subtitle:false,body:true})+`<h3 style="font-size:10px;margin:17px 0 8px">Metrics</h3><div class="repeater">${repeatRows(s,c.items,'stats')}<button class="add-row" data-add-item>Add metric</button></div>`}
 else if(s.family==='pricing'){html=commonContentFields(s,{subtitle:false,body:true})+`<h3 style="font-size:10px;margin:17px 0 8px">Packages</h3><div class="repeater">${repeatRows(s,c.items,'pricing')}<button class="add-row" data-add-item>Add package</button></div>`}
 else if(s.family==='tabs'){html=commonContentFields(s,{subtitle:true,body:false})+`<h3 style="font-size:10px;margin:17px 0 8px">Tab panels</h3><div class="repeater">${(c.items||[]).map((x,i)=>`<div style="border:1px solid #e4e1da;padding:9px;margin-bottom:7px"><div class="repeat-row"><input data-item="${i}" data-key="title" value="${escAttr(x.title||'')}" placeholder="Tab label"><input data-item="${i}" data-key="heading" value="${escAttr(x.heading||'')}" placeholder="Panel heading"><button class="mini-btn danger" data-remove-item="${i}">${ICONS.trash}</button></div><div class="repeat-row wide" style="margin-top:6px"><input data-item="${i}" data-key="body" value="${escAttr(x.body||'')}" placeholder="Panel description"><span></span></div></div>`).join('')}<button class="add-row" data-add-item>Add tab</button></div>`}
 else if(s.family==='contact'){html=commonContentFields(s,{subtitle:false,body:true})+`<div class="panel-note" style="margin-top:14px;margin-bottom:0">The exported HTML shows a clearly labeled form slot. The JSON retains <code>gravityforms/form</code> for your importer to connect in WordPress.</div>`}
 else {html=commonContentFields(s,{subtitle:true,body:true})+`<h3 style="font-size:10px;margin:17px 0 8px">Items</h3><div class="repeater">${repeatRows(s,c.items)}<button class="add-row" data-add-item>Add item</button></div>`}return html}
function renderMediaEditor(s){const current=(s.content.media?.[0]||s.content.items?.[0]?.media||{}).src;return `<div class="panel-note">Every visual slot uses skill-approved Pexels or skill-example media with alt text and source metadata. Replace it at any time without changing the component tree.</div><div class="media-picker">${DATA.media.map((m,i)=>`<button class="media-option ${m.src===current?'selected':''}" data-media-index="${i}" title="${escAttr(m.alt)}"><img loading="lazy" src="${escAttr(m.src)}" alt=""><span>${esc(m.group||'media')}</span></button>`).join('')}</div><div class="field-grid" style="margin-top:14px">${field('Custom image URL',`section.${s.id}.customMedia`,current||'',{full:true,help:'A custom URL is stored with source metadata as user-provided.'})}${field('Image alt text',`section.${s.id}.mediaAlt`,(s.content.media?.[0]||s.content.items?.[0]?.media||{}).alt||'',{full:true})}</div>`}
function ensureSectionSettings(s){const preset=sectionPreset(s.family,0);s.layout={container:preset.container||s.node?.layout?.container||'default',paddingTop:preset.paddingTop||s.node?.layout?.padding?.top||'default',paddingBottom:preset.paddingBottom||s.node?.layout?.padding?.bottom||'default',inverted:!!preset.inverted,background:'auto',...(s.layout||{})};s.effects={viewport:preset.viewport||'fade-up',scroll:preset.scroll||'',repeat:false,...(s.effects||{})};if(s.decoration===undefined)s.decoration=preset.decoration||null}
function renderLayoutEditor(s){ensureSectionSettings(s);const l=s.layout,e=s.effects;const motifs=Object.keys(DATA.decorations).sort();return `<div class="field-grid">${field('Content measure',`setting.${s.id}.container`,l.container,{type:'select',options:[{value:'default',label:'Default container'},{value:'alt',label:'Narrow / alt container'},{value:'wide',label:'Wide container'},{value:'full',label:'Full bleed band'}]})}${field('Color treatment',`setting.${s.id}.inverted`,String(l.inverted),{type:'select',options:[{value:'false',label:'Light / standard'},{value:'true',label:'Inverted / dark'}]})}${field('Top rhythm',`setting.${s.id}.paddingTop`,l.paddingTop,{type:'select',options:[{value:'none',label:'None'},{value:'small',label:'Small'},{value:'default',label:'Default'},{value:'large',label:'Large'}]})}${field('Bottom rhythm',`setting.${s.id}.paddingBottom`,l.paddingBottom,{type:'select',options:[{value:'none',label:'None'},{value:'small',label:'Small'},{value:'default',label:'Default'},{value:'large',label:'Large'}]})}</div><h3 style="font-size:10px;margin:18px 0 8px">Motion</h3><div class="field-grid">${field('Viewport effect',`effect.${s.id}.viewport`,e.viewport||'',{type:'select',options:['','fade','fade-up','fade-down','fade-left','fade-right','zoom-in','slide-up','animate-headings'].map(x=>({value:x,label:x||'None'}))})}${field('Scroll-driven effect',`effect.${s.id}.scroll`,e.scroll||'',{type:'select',options:['','bg-zoom-in','bg-zoom-out','parallax-bg','parallax-up','parallax-down','scroll-fade','reveal','zoom-scrub','rotate-scrub','cascade','highlight','stack-cards'].map(x=>({value:x,label:x||'None'}))})}</div><h3 style="font-size:10px;margin:18px 0 8px">Decoration</h3><div class="field-grid">${field('Registered motif',`decoration.${s.id}.motif`,s.decoration?.motif||'',{type:'select',options:[{value:'',label:'None'},...motifs.map(x=>({value:x,label:x}))]})}${field('Position',`decoration.${s.id}.position`,s.decoration?.position||'cover',{type:'select',options:['cover','top-left','top-right','bottom-left','bottom-right','center','top','bottom'].map(x=>({value:x,label:x}))})}</div><div class="panel-note" style="margin-top:14px;margin-bottom:0">Use decoration as authored structure: a background motif, a corner mark, or a band join. The builder keeps it behind content and clips it safely.</div>`}
function treeHtml(node,depth=0){return `<div class="tree-node" style="margin-left:${depth?8:0}px"><div class="tree-line"><span class="tree-chip">${esc(node.component)}</span><span class="tree-use">${esc(node.usage||'')}</span></div>${(node.children||[]).map(c=>treeHtml(c,depth+1)).join('')}</div>`}
function renderAdvancedEditor(s){return `<div class="panel-note">This is the actual exported DST block tree from the selected pattern. Advanced edits are applied directly; invalid JSON is never saved.</div><div class="tree">${treeHtml(s.node)}</div><details style="margin-top:15px"><summary style="font-size:10px;font-weight:700;cursor:pointer">Edit this module as JSON</summary><textarea id="treeJsonEditor" class="json-editor" spellcheck="false">${esc(JSON.stringify(s.node,null,2))}</textarea><button class="export-btn" data-action="apply-tree" style="margin-top:8px">Apply tree JSON</button></details>`}
function renderModules(){const s=state.project.sections.find(x=>x.id===state.selectedSectionId)||state.project.sections[0];if(s)state.selectedSectionId=s.id;const editor=s?({content:renderContentEditor,media:renderMediaEditor,layout:renderLayoutEditor,advanced:renderAdvancedEditor}[state.editorTab]||renderContentEditor)(s):'';return pageHead('04 · Modules','Shape each module without leaving DST.','Switch among all registered SBS patterns, edit the content model, choose skill media, tune effects, or inspect the exact block tree.',s?`${s.family} · ${s.patternId}`:'No modules')+
 panel('Page modules',`<div id="moduleList" class="module-list">${moduleRows()}</div><button class="add-row" data-action="add-module" style="width:100%;margin-top:8px">+ Add a DST module</button>`,'Select to edit')+
 (s?panel('Selected pattern',`<div class="pattern-summary"><div class="pattern-thumb"></div><div><b>${esc(patternLabel(s))}</b><span>${esc(s.patternId)} · ${esc(s.family)}</span></div><button class="text-btn" data-action="choose-pattern">Change pattern</button></div>`)+
 panel('Module editor',`<div class="segmented" style="margin-bottom:15px"><button class="${state.editorTab==='content'?'active':''}" data-editor-tab="content">Content</button><button class="${state.editorTab==='media'?'active':''}" data-editor-tab="media">Media</button><button class="${state.editorTab==='layout'?'active':''}" data-editor-tab="layout">Layout + effects</button><button class="${state.editorTab==='advanced'?'active':''}" data-editor-tab="advanced">DST tree</button></div>${editor}`,'',
 'data-module-editor'):`<div class="empty-state"><b>Add the first module</b><p>Choose from the complete registered pattern library.</p><button class="export-btn" data-action="add-module">Add module</button></div>`)+renderEditorNav()}
function validateProject(){const sections=state.project.sections;const comps=[];const images=[];sections.forEach(s=>walkNode(s.node,n=>{comps.push(n.component);const a=n.attributes||{};if(a.media?.src)images.push(a.media);if(a.backgroundImage?.src)images.push(a.backgroundImage)}));const unknown=[...new Set(comps.filter(c=>!DATA.registry[c]))];const patternMissing=sections.filter(s=>!patternMap.has(s.patternId));const heroCount=sections.filter(s=>s.family==='hero').length;const scrollCount=sections.filter(s=>s.effects?.scroll).length;const animatedHeading=sections.filter(s=>s.effects?.viewport==='animate-headings').length;const emptyTitles=sections.filter(s=>!cleanText(s.content?.title));const missingAlt=images.filter(m=>m.src&&!cleanText(m.alt));const checks=[
 {status:sections.length>=3?'pass':'fail',title:'Page has a complete sequence',detail:`${sections.length} modules in the current flow.`,code:'STRUCTURE'},
 {status:heroCount===1?'pass':heroCount?'warn':'fail',title:'One clear opening hero',detail:`Found ${heroCount} hero module${heroCount===1?'':'s'}.`,code:'HERO'},
 {status:patternMissing.length?'fail':'pass',title:'Pattern provenance is intact',detail:patternMissing.length?`${patternMissing.length} missing pattern references.`:'Every module resolves to the attached SBS library.',code:'PATTERNS'},
 {status:unknown.length?'fail':'pass',title:'Only registered components are exported',detail:unknown.length?unknown.join(', '):`${new Set(comps).size} component types checked against the registry.`,code:'REGISTRY'},
 {status:emptyTitles.length?'warn':'pass',title:'Core content is populated',detail:emptyTitles.length?`${emptyTitles.length} module titles are empty.`:'Every module has a purposeful title.',code:'CONTENT'},
 {status:missingAlt.length?'warn':'pass',title:'Media carries alt text',detail:missingAlt.length?`${missingAlt.length} image slots need alt text.`:`${images.length} media references checked.`,code:'MEDIA'},
 {status:scrollCount<=2?'pass':'warn',title:'Motion budget is restrained',detail:`${scrollCount} scroll-driven device${scrollCount===1?'':'s'}; ${animatedHeading} heading reveal${animatedHeading===1?'':'s'}.`,code:'MOTION'},
 {status:sections.some(s=>(s.content?.buttons||[]).length||s.family==='contact')?'pass':'warn',title:'The page has a conversion path',detail:'CTA rhythm is represented in the exported tree.',code:'CTA'},
 {status:'pass',title:'Reduced-motion fallback is included',detail:'The standalone HTML reveals all content when reduced motion is preferred.',code:'A11Y'},
 {status:'pass',title:'Importer envelope is ready',detail:`Schema dst-concept-export/1.0 · catalogVersion ${DATA.skill.catalogVersion}.`,code:'EXPORT'}
];return {checks,comps:[...new Set(comps)],images,score:Math.round(checks.reduce((n,c)=>n+(c.status==='pass'?1:c.status==='warn'?.55:0),0)/checks.length*100),warnings:checks.filter(c=>c.status==='warn').length,failures:checks.filter(c=>c.status==='fail').length}}
function renderReview(){const v=validateProject();return pageHead('05 · Review & export','A page the team can use today.','The same project source drives the live preview, the standalone HTML and the WordPress importer JSON. Review the gates, then download both artifacts.',v.failures?`${v.failures} blockers`:v.warnings?`${v.warnings} notes`:'Ready')+
 panel('Concept health',`<div class="review-grid"><div class="score-card"><b>${v.score}</b><span>Readiness score</span></div><div class="score-card"><b>${state.project.sections.length}</b><span>Page modules</span></div><div class="score-card"><b>${v.comps.length}</b><span>Component types</span></div></div>`)+
 panel('Preflight checks',`<div class="check-list">${v.checks.map(c=>`<div class="check ${c.status}"><span class="check-ico">${c.status==='pass'?'✓':c.status==='warn'?'!':'×'}</span><div><b>${esc(c.title)}</b><p>${esc(c.detail)}</p></div><code>${c.code}</code></div>`).join('')}</div>`,'Skill-aware')+
 panel('Downloads',`<div class="export-card"><div class="export-icon"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M10 13h5M10 17h5"/></svg></div><div><b>WordPress importer JSON</b><p>Complete DST concept envelope, header/footer shorthand, real pattern IDs, node trees, media metadata, effects and decorations.</p></div><button class="export-btn" data-export="json">Download JSON</button></div><div class="export-card"><div class="export-icon"><svg viewBox="0 0 24 24"><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/></svg></div><div><b>Standalone website HTML</b><p>Responsive single-file preview with the same renderer, DST CSS, interactions, Pexels placeholders and reduced-motion support.</p></div><button class="export-btn" data-export="html">Download HTML</button></div><div class="export-card"><div class="export-icon"><svg viewBox="0 0 24 24"><path d="M4 6h16v12H4zM8 10h8M8 14h5"/></svg></div><div><b>Copy project JSON</b><p>Useful for review, issue tickets and comparing concept revisions without downloading a file.</p></div><button class="export-btn" data-export="copy">Copy</button></div>`)+renderEditorNav()}
function renderEditor(){const renderers=[renderBrief,renderDirection,renderFlow,renderModules,renderReview];byId('editorInner').innerHTML=renderers[state.currentStep]();bindDragRows()}
function renderAll(){renderStepNav();renderEditor();updateTop();updateDevice();queuePreview();updateUndoButtons()}
function updateTop(){const b=state.project.brief;byId('projectTitle').value=b.projectName||state.project.client||'Untitled project';byId('previewUrl').textContent=`${slugify(b.projectName)}.local`;byId('patternCount').textContent=DATA.skill.patternCount;byId('componentCount').textContent=Object.keys(DATA.registry).length}
function updateDevice(){const shell=byId('deviceShell'),stage=document.querySelector('.preview-stage'),width={desktop:1440,tablet:820,mobile:390}[state.device]||1440;shell.className=`device-shell ${state.device}`;if(!state.zoom){const available=Math.max(260,(stage?.clientWidth||760)-54);state.zoom=clamp(available/width,.3,1)}const scale=state.zoom;shell.style.zoom=String(scale);shell.style.transform='none';shell.style.marginBottom='';document.querySelectorAll('.device-btn').forEach(b=>b.classList.toggle('active',b.dataset.device===state.device));byId('zoomLabel').textContent=`${Math.round(scale*100)}%`}
function queuePreview(){clearTimeout(previewTimer);previewTimer=setTimeout(renderPreview,110)}
function renderPreview(){try{byId('sitePreview').srcdoc=buildSiteDocument(state.project)}catch(e){console.error(e);byId('sitePreview').srcdoc=`<pre style="padding:20px;font:14px monospace">Preview error: ${esc(e.message)}</pre>`}}
function goStep(i){state.currentStep=clamp(i,0,STEPS.length-1);queueSave();renderStepNav();renderEditor();document.querySelector('.editor').scrollTop=0}
function applyArchetype(key){const style=DATA.archetypeStyles[key];if(!style)return;mutate(()=>{state.project.design.archetype=key;state.project.design.palette={bg:style.bg,ink:style.ink,accent:style.accent,soft:style.soft,dark:style.dark};state.project.design.fontBody=style.fontBody;state.project.design.fontDisplay=style.fontDisplay;state.project.design.radius=style.radius},{message:`Applied archetype ${key} · ${DATA.archetypes[key]?.name||''}`})}
/** Rebuilds the active concept's page from a flow, reusing modules where it can. */
function applyFlowToActiveConcept(flow){
  const pool={};
  state.project.sections.forEach(s=>(pool[s.family]||(pool[s.family]=[])).push(s));
  state.project.sections=flow.families.map((family,i)=>{
    const existing=pool[family]?.shift();
    if(existing)return existing;
    return createSection(family,i);
  });
  state.project.flowId=flow.id;
  state.selectedSectionId=state.project.sections[0]?.id||null;
}

/** Applies a page flow to the concept being edited. Extended below. */
function applyFlow(id){
  const flow=flowById(id);
  if(!flow)return;
  mutate(()=>applyFlowToActiveConcept(flow),{message:`Applied ${flow.id} · ${flow.name}`});
}
function duplicateSection(id){const index=state.project.sections.findIndex(s=>s.id===id);if(index<0)return;mutate(()=>{const copy=deepClone(state.project.sections[index]);copy.id=uid(`section-${copy.family}`);rekeyTree(copy.node,copy.id);copy.content.title=(copy.content.title||familyLabels[copy.family])+' — alternate';state.project.sections.splice(index+1,0,copy);state.selectedSectionId=copy.id},{message:'Module duplicated'})}
function removeSection(id){const index=state.project.sections.findIndex(s=>s.id===id);if(index<0)return;mutate(()=>{state.project.sections.splice(index,1);state.selectedSectionId=state.project.sections[Math.min(index,state.project.sections.length-1)]?.id||null},{message:'Module removed'})}
function switchPattern(section,pattern){const old=section.content||{};const fresh=contentFor(pattern.family,0);for(const key of ['pretitle','title','subtitle','body','buttons','media'])if(old[key]!=null)fresh[key]=deepClone(old[key]);section.family=pattern.family;section.patternId=pattern.id;section.node=deepClone(pattern.tree);section.fidelity=null;rekeyTree(section.node,section.id);section.content={...fresh,...Object.fromEntries(Object.entries(old).filter(([k])=>k in fresh))};section.node.pattern=pattern.id;section.node.role=pattern.family;section.node.patternMeta={family:pattern.family,category:pattern.category,title:pattern.title,look:pattern.look};syncSectionNode(section)}
let patternModalContext='change';
function openPatternModal(mode='change'){patternModalContext=mode;const select=byId('patternFamily');const families=[...new Set(DATA.patterns.map(p=>p.family))].sort();select.innerHTML='<option value="all">All families</option>'+families.map(f=>`<option value="${escAttr(f)}">${esc(familyLabels[f]||f)} (${familyPatterns(f).length})</option>`).join('');const s=state.project.sections.find(x=>x.id===state.selectedSectionId);select.value=mode==='change'&&s?s.family:'all';byId('patternSearch').value='';byId('patternModal').classList.add('open');renderPatternGrid();setTimeout(()=>byId('patternSearch').focus(),50)}
function closePatternModal(){byId('patternModal').classList.remove('open')}
function renderPatternGrid(){const query=byId('patternSearch').value.trim().toLowerCase(),family=byId('patternFamily').value,sort=byId('patternSort').value;const current=state.project.sections.find(x=>x.id===state.selectedSectionId);let rows=DATA.patterns.filter(p=>(family==='all'||p.family===family)&&(!query||[p.title,p.family,p.category,p.look,p.id].join(' ').toLowerCase().includes(query)));if(sort==='title')rows.sort((a,b)=>a.title.localeCompare(b.title));else if(sort==='family')rows.sort((a,b)=>(a.family+a.title).localeCompare(b.family+b.title));else rows.sort((a,b)=>Number(b.family===current?.family)-Number(a.family===current?.family)||a.title.localeCompare(b.title));byId('modalPatternCount').textContent=rows.length;byId('patternGrid').innerHTML=rows.map(p=>`<button class="pattern-card ${p.id===current?.patternId?'selected':''}" data-pattern-id="${p.id}"><div class="pattern-visual ${p.family}"><span class="pv-copy"><i></i><i></i><i></i></span><span class="pv-media"></span></div><div class="pattern-card-body"><b>${esc(p.title)}</b><span>${esc(p.family)} · ${esc(p.category||'pattern')}</span><p>${esc(p.look||'Registered DST pattern')}</p></div></button>`).join('')||'<div class="empty-state choice-wide"><b>No matching patterns</b><p>Clear the search or choose another family.</p></div>'}
/*
 * A pattern chosen by hand is locked against later style re-selection. Without
 * this, picking a style after choosing a pattern would silently undo the choice —
 * and an explicit selection is the one input that always wins.
 */
function choosePattern(id){const p=patternMap.get(id);if(!p)return;if(patternModalContext==='add'){mutate(()=>{const s=createSection(p.family,state.project.sections.length,p.id);state.project.sections.push(s);state.selectedSectionId=s.id;state.editorTab='content'},{message:`Added ${p.title}`})}else{const s=state.project.sections.find(x=>x.id===state.selectedSectionId);if(s)mutate(()=>{switchPattern(s,p);s.patternLocked=true},{message:`Changed to ${p.title}`})}closePatternModal()}
function bindDragRows(){let dragged=null;document.querySelectorAll('.module-row[draggable="true"]').forEach(row=>{row.addEventListener('dragstart',e=>{dragged=row.dataset.sectionId;e.dataTransfer.effectAllowed='move';row.style.opacity='.45'});row.addEventListener('dragend',()=>{row.style.opacity='';dragged=null});row.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move'});row.addEventListener('drop',e=>{e.preventDefault();const target=row.dataset.sectionId;if(!dragged||dragged===target)return;checkpoint();const arr=state.project.sections,from=arr.findIndex(x=>x.id===dragged),to=arr.findIndex(x=>x.id===target);const [item]=arr.splice(from,1);arr.splice(to,0,item);queueSave();renderAll();announce('Module reordered')})})}
function currentSection(){return state.project.sections.find(x=>x.id===state.selectedSectionId)}
function inputCheckpoint(){if(!inputHistoryTimer)checkpoint();clearTimeout(inputHistoryTimer);inputHistoryTimer=setTimeout(()=>{inputHistoryTimer=null},850)}
function updateBinding(path,value,input){inputCheckpoint();let rerender=false;if(path.startsWith('brief.'))setPath(state.project,path,value);else if(path.startsWith('design.')){if(input?.type==='range')value=Number(value);setPath(state.project,path,value)}else if(path.startsWith('section.')){const [,id,key]=path.split('.');const s=state.project.sections.find(x=>x.id===id);if(s){if(key==='customMedia'){const m={src:value,alt:s.content.media?.[0]?.alt||'User-provided image',source:'user-provided',intent:'editorial-photo'};s.content.media=[m];if((s.content.items||[]).some(x=>x.media))s.content.items.forEach((x,i)=>{if(i===0)x.media=m})}else if(key==='mediaAlt'){if(!s.content.media?.length)s.content.media=[mediaChoice(s,0)];s.content.media[0].alt=value;if(s.content.items?.[0]?.media)s.content.items[0].media.alt=value}else s.content[key]=value;syncSectionNode(s)}}else if(path.startsWith('setting.')){const [,id,key]=path.split('.');const s=state.project.sections.find(x=>x.id===id);if(s){ensureSectionSettings(s);s.layout[key]=key==='inverted'?value==='true':value;s.node.layout=s.node.layout||{};s.node.layout.container=s.layout.container;s.node.layout.padding={top:s.layout.paddingTop,bottom:s.layout.paddingBottom};s.node.inverted=s.layout.inverted}}else if(path.startsWith('effect.')){const [,id,key]=path.split('.');const s=state.project.sections.find(x=>x.id===id);if(s){s.effects[key]=value;syncSectionNode(s)}}else if(path.startsWith('decoration.')){const [,id,key]=path.split('.');const s=state.project.sections.find(x=>x.id===id);if(s){if(!s.decoration)s.decoration={motif:'',position:'cover',opacity:.04,scale:1};s.decoration[key]=value;if(key==='motif'&&!value)s.decoration=null;syncSectionNode(s)}}queueSave();queuePreview();if(input?.type==='range'){const output=input.previousElementSibling?.querySelector('output')||input.parentElement.querySelector('output');if(output)output.textContent=value}if(rerender)renderEditor()}

byId('stepNav').addEventListener('click',e=>{const b=e.target.closest('[data-step]');if(b)goStep(Number(b.dataset.step))});
byId('editorInner').addEventListener('input',e=>{const el=e.target;if(el.dataset.bind)updateBinding(el.dataset.bind,el.value,el);const s=currentSection();if(!s)return;if(el.dataset.sectionField){inputCheckpoint();s.content[el.dataset.sectionField]=el.value;syncSectionNode(s);queueSave();queuePreview()}if(el.dataset.item!=null){inputCheckpoint();const item=s.content.items?.[Number(el.dataset.item)];if(item){item[el.dataset.key]=el.value;syncSectionNode(s);queueSave();queuePreview()}}if(el.dataset.button!=null){inputCheckpoint();const item=s.content.buttons?.[Number(el.dataset.button)];if(item){item[el.dataset.key]=el.value;syncSectionNode(s);queueSave();queuePreview()}}if(el.dataset.csv){inputCheckpoint();s.content[el.dataset.csv]=el.value.split(',').map(x=>x.trim()).filter(Boolean);syncSectionNode(s);queueSave();queuePreview()}if(el.dataset.lines){inputCheckpoint();s.content[el.dataset.lines]=el.value.split('\n').map(x=>x.trim()).filter(Boolean);syncSectionNode(s);queueSave();queuePreview()}});
byId('editorInner').addEventListener('change',e=>{const el=e.target;if(el.dataset.bind)updateBinding(el.dataset.bind,el.value,el)});
byId('editorInner').addEventListener('click',e=>{const step=e.target.closest('[data-nav]');if(step){goStep(step.dataset.nav==='next'?(state.currentStep===STEPS.length-1?0:state.currentStep+1):state.currentStep-1);return}const arch=e.target.closest('[data-archetype]');if(arch){applyArchetype(arch.dataset.archetype);return}const flow=e.target.closest('[data-flow]');if(flow){applyFlow(flow.dataset.flow);return}const exp=e.target.closest('[data-export]');if(exp){handleExport(exp.dataset.export);return}const tab=e.target.closest('[data-editor-tab]');if(tab){state.editorTab=tab.dataset.editorTab;renderEditor();return}const media=e.target.closest('[data-media-index]');if(media){const s=currentSection(),idx=Number(media.dataset.mediaIndex),m=asMedia(DATA.media[idx]);if(s)mutate(()=>{s.content.media=[m];(s.content.items||[]).forEach((item,i)=>{if(item.media)item.media=asMedia(DATA.media[(idx+i)%DATA.media.length])})},{message:'Media updated'});return}const removeItem=e.target.closest('[data-remove-item]');if(removeItem){const s=currentSection();if(s)mutate(()=>s.content.items.splice(Number(removeItem.dataset.removeItem),1),{message:'Item removed'});return}const addItem=e.target.closest('[data-add-item]');if(addItem){const s=currentSection();if(s)mutate(()=>{if(!s.content.items)s.content.items=[];if(s.family==='stats')s.content.items.push({value:String(s.content.items.length+1).padStart(2,'0'),label:'New metric',description:'Explain what it proves.'});else if(s.family==='pricing')s.content.items.push({title:'New package',price:'Custom',text:'Describe the package.',features:['First inclusion','Second inclusion']});else if(s.family==='tabs')s.content.items.push({title:'New tab',heading:'New panel',body:'Add substantial panel content.',bullets:['First point'],media:mediaChoice(s,s.content.items.length)});else s.content.items.push({title:'New item',text:'Add useful supporting copy.',media:mediaChoice(s,s.content.items.length)})},{message:'Item added'});return}const removeButton=e.target.closest('[data-remove-button]');if(removeButton){const s=currentSection();if(s)mutate(()=>s.content.buttons.splice(Number(removeButton.dataset.removeButton),1));return}if(e.target.closest('[data-add-button]')){const s=currentSection();if(s)mutate(()=>{s.content.buttons=s.content.buttons||[];s.content.buttons.push({text:'New action',link:'#contact'})});return}const action=e.target.closest('[data-action]');if(action){const id=action.dataset.id;if(action.dataset.action==='duplicate')duplicateSection(id);else if(action.dataset.action==='remove')removeSection(id);else if(action.dataset.action==='add-module')openPatternModal('add');else if(action.dataset.action==='choose-pattern')openPatternModal('change');else if(action.dataset.action==='apply-tree'){const s=currentSection(),parsed=safeJson(byId('treeJsonEditor').value);if(!parsed){announce('Invalid JSON — nothing was changed');return}mutate(()=>{s.node=parsed;s.patternId=parsed.pattern||s.patternId;s.family=parsed.role||s.family},{message:'DST tree applied'})}return}const row=e.target.closest('.module-row');if(row&&!e.target.closest('button')){state.selectedSectionId=row.dataset.sectionId;state.editorTab='content';
  // Picking a module from the Page flow step opens it in the Modules step. That
  // index used to be hard-coded to the advanced builder's, and the simple
  // builder is a step shorter — so there it landed on Review & export and threw
  // the strategist off the module they had just selected. Modules is always the
  // second-to-last step, and the rendered nav is the one list that is definitely
  // the running mode's (the mode's own step array is declared further down this
  // file, out of scope here).
  const steps=document.querySelectorAll('#stepNav [data-step]').length||STEPS.length,modulesStep=steps-2;
  if(state.currentStep===modulesStep-1){state.currentStep=modulesStep;renderAll()}else renderEditor();queueSave()}});

byId('projectTitle').addEventListener('input',e=>{inputCheckpoint();state.project.brief.projectName=e.target.value;state.project.client=e.target.value;queueSave();queuePreview();byId('previewUrl').textContent=`${slugify(e.target.value)}.local`});
byId('undoBtn').addEventListener('click',undo);byId('redoBtn').addEventListener('click',redo);
const topExportBtn=byId('topExportBtn');if(topExportBtn)topExportBtn.addEventListener('click',()=>handleExport('json'));byId('openPreviewBtn').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([buildSiteDocument(state.project)],{type:'text/html'}));window.open(url,'_blank','noopener');setTimeout(()=>URL.revokeObjectURL(url),60000)});
document.querySelectorAll('.device-btn').forEach(b=>b.addEventListener('click',()=>{state.device=b.dataset.device;state.zoom=0;updateDevice();queueSave()}));
byId('zoomOutBtn').addEventListener('click',()=>{state.zoom=clamp(state.zoom-.08,.3,1);updateDevice();queueSave()});byId('zoomInBtn').addEventListener('click',()=>{state.zoom=clamp(state.zoom+.08,.3,1);updateDevice();queueSave()});
byId('closePatternModal').addEventListener('click',closePatternModal);byId('patternModal').addEventListener('click',e=>{if(e.target===byId('patternModal'))closePatternModal();const card=e.target.closest('[data-pattern-id]');if(card)choosePattern(card.dataset.patternId)});byId('patternSearch').addEventListener('input',renderPatternGrid);byId('patternFamily').addEventListener('change',renderPatternGrid);byId('patternSort').addEventListener('change',renderPatternGrid);
document.addEventListener('keydown',e=>{if(e.key==='Escape')closePatternModal();if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo()}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();handleExport('json')}});
function rich(value){return esc(value).replace(/\n/g,'<br>').replace(/\*([^*]+)\*/g,'<em>$1</em>')}
function containerClass(value){return value==='alt'?'c-alt':value==='wide'?'c-wide':value==='full'?'c-full':'c-default'}
function rhythmClass(value,axis){const map={none:'0',small:'s',default:'',large:'l'};const suffix=map[value]??'';return `${axis}${suffix?'-'+suffix:''}`}
function sectionClasses(section){ensureSectionSettings(section);const l=section.layout;return [rhythmClass(l.paddingTop,'dt'),rhythmClass(l.paddingBottom,'db'),l.inverted?'is-style-colors-inverted':'',section.decoration?'has-deco':'',section.effects?.scroll?'has-scroll-effect':''].filter(Boolean).join(' ')}
function sectionBgClass(section,index){if(section.layout?.inverted||section.family==='cta')return 'sbs-band-dark';if(['logo','tabs','faq','accordion'].includes(section.family))return 'sbs-band-soft';if(index%4===3)return 'sbs-band-tint';return 'sbs-band-paper'}
function renderDecoration(section){const d=section.decoration;if(!d?.motif||!DATA.decorations[d.motif])return '';const def=DATA.decorations[d.motif],id=`deco-${slugify(section.id)}-${slugify(d.motif)}`,inner=String(def.inner||'').replaceAll('__ID__',id),pos=d.position||'cover',view=def.viewBox||'0 0 600 600';return `<div class="c-decoration" aria-hidden="true"><span class="dst-deco dst-deco--${escAttr(pos)}" style="color:var(--dst--primary-color2);opacity:${Number(d.opacity??.04)};--deco-scale:${Number(d.scale||1)}"><svg viewBox="${escAttr(view)}" width="100%" height="100%" preserveAspectRatio="${def.kind==='pattern'?'xMidYMid slice':'xMidYMid meet'}" xmlns="http://www.w3.org/2000/svg">${inner}</svg></span></div>`}
function renderMediaValue(media,classes='',ratio='16/9'){const m=media?.src?media:null;if(!m)return `<figure class="ph ${classes}" style="--ar:${escAttr(ratio)}"><span class="ph__ico" aria-hidden="true">◇</span><figcaption class="ph__cap">Media placeholder</figcaption></figure>`;return `<figure class="ph ph--photo ph--real ${classes}" style="--ar:${escAttr(m.ratioDesktop||ratio)}"><img loading="lazy" src="${escAttr(m.src)}" alt="${escAttr(m.alt||'Editorial image')}">${m.caption?`<figcaption class="ph__cap">${esc(m.caption)}</figcaption>`:''}</figure>`}
function renderBackground(media,family){if(!media?.src)return '';return `<div class="c-bg"><img class="c-bg__layer" src="${escAttr(media.src)}" alt="" loading="eager"></div><div class="c-overlay"></div>`}
function nodeChildren(node,ctx,filter=()=>true){return (node.children||[]).filter(filter).map((c,i)=>renderNode(c,{...ctx,childIndex:i})).join('')}
function accentTitle(title,accents=[]){let out=esc(title);for(const ac of accents||[]){const text=String(ac?.text||'');if(!text)continue;const styles=Array.isArray(ac.style)?ac.style:[ac.style].filter(Boolean);let cls='dst-accent';if(styles.includes('highlight'))cls+=' dst-accent--highlight';let inner=esc(text);if(styles.includes('italic'))inner=`<em>${inner}</em>`;if(styles.includes('bold'))inner=`<strong>${inner}</strong>`;const style=(styles.includes('color')||styles.includes('highlight'))&&ac.color?` style="--dst-hl:var(--dst--${escAttr(ac.color)});${styles.includes('color')?`color:var(--dst--${escAttr(ac.color)});`:''}"`:'';out=out.replace(esc(text),`<span class="${cls}"${style}>${inner}</span>`)}return out}
function renderHeading(node,ctx){const a=node.attributes||{};const alignment=(a.alignment||'left').replace('text-','');const isHero=ctx.family==='hero'&&!ctx.h1Used;const title=a.title||'';if(isHero)ctx.h1Used=true;const tag=isHero?'h1':ctx.nestedHeading?'h3':'h2';const size=isHero?'-h1':ctx.nestedHeading?'-h3':'-h2';const children=nodeChildren(node,{...ctx,nestedHeading:true});return `<div class="dst-heading c-heading text-${escAttr(alignment)} text-left-mobile ${ctx.topHeading?'mb-s':''}" data-viewport="true" data-viewport-effect="${escAttr(ctx.section.effects?.viewport||'fade-up')}">${a.pretitle?`<div class="c-heading__pre">${rich(a.pretitle)}</div>`:''}${title?`<${tag} class="c-heading__title ${size}">${accentTitle(title,node.titleAccents)}</${tag}>`:''}${a.subtitle?`<div class="c-heading__sub">${rich(a.subtitle)}</div>`:''}${children?`<div class="c-heading__description">${children}</div>`:''}</div>`}
function renderButton(node,ctx){const a=node.attributes||{};if(!cleanText(a.text))return '';const secondary=a.btnType==='secondary'||a.btnType==='link',cls=a.btnType==='link'?'-link':secondary?(ctx.section.layout?.inverted?'-secondary-inverted':'-secondary'):(ctx.section.layout?.inverted?'-primary-inverted':'-primary');return `<a class="c-btn ${cls}" href="${escAttr(normalizeLink(a.link||'#'))}"><span class="c-btn__txt">${esc(a.text||'Learn more')}</span>${a.hasIcon!==false?`<span class="sbs-btn-arrow" aria-hidden="true">↗</span>`:''}</a>`}
function renderCard(node,ctx){const a=node.attributes||{},media=a.media?.src?a.media:null;if(ctx.family==='testimonial'||a.quote){return `<article class="c-block dst-card sbs-quote-card"><div class="sbs-quote-mark" aria-hidden="true">“</div><blockquote>${rich(a.quote||a.description||'')}</blockquote><div class="c-quote__profile">${media?`<span class="c-quote__photo">${renderMediaValue(media,'','1/1')}</span>`:''}<div class="c-quote__author"><b>${esc(a.author||a.title||'Client')}</b><span>${esc(a.role||a.pretitle||'')}</span></div></div></article>`}const bgMode=ctx.family==='cards'&&media;const classes=bgMode?'dst-card--media-background align-bottom':'dst-card--media-top';return `<article class="c-block dst-card ${classes} ${ctx.family==='gallery'?'sbs-gallery-card':''}">${media?`<div class="c-block__media">${renderMediaValue(media,'',ctx.family==='team'?'4/5':'4/3')}</div>`:''}${bgMode?'<div class="c-block__scrim"></div>':''}<div class="c-block__body">${a.pretitle?`<div class="c-block__tagline">${esc(a.pretitle)}</div>`:''}${a.title?`<h3 class="c-block__title">${rich(a.title)}</h3>`:''}${a.description?`<div class="c-block__description">${rich(a.description)}</div>`:''}${a.button?.text?`<a class="c-btn -link -small" href="${escAttr(normalizeLink(a.button.link||'#'))}">${esc(a.button.text)}</a>`:''}</div></article>`}
function renderListItem(node,ctx){const a=node.attributes||{},timeline=ctx.listTimeline,stats=ctx.family==='stats';return `<li class="dst-list__item">${a.heroText?`<div class="dst-list__hero${stats?' sbs-stat-value':''}">${rich(a.heroText)}</div>`:a.icon?`<div class="dst-list__media"><span class="dst-ico sbs-check" aria-hidden="true">${stats?'':'✓'}</span></div>`:''}<div class="dst-list__content">${a.listTitle?`<h3 class="dst-list__title">${rich(a.listTitle)}</h3>`:''}${a.listSubTitle?`<div class="dst-list__description">${rich(a.listSubTitle)}</div>`:''}</div></li>`}
function renderTabs(node,ctx){const labels=node.attributes?.tabItem||{},tabs=node.children||[];return `<div class="dst-tabs sbs-tabs" data-tabs><div class="dst-tabs__navbar" role="tablist">${tabs.map((t,i)=>`<button class="dst-tabs__navbar-item sbs-tab-button ${i===0?'is-active':''}" role="tab" aria-selected="${i===0}" data-tab-index="${i}">${rich(labels[String(i+1)]?.content||`Tab ${i+1}`)}</button>`).join('')}</div><div class="sbs-tab-panels">${tabs.map((t,i)=>`<div class="dst-tabs__panel sbs-tab-panel ${i===0?'is-active':''}" role="tabpanel">${nodeChildren(t,{...ctx,nestedHeading:true})}</div>`).join('')}</div></div>`}
function renderAccordion(node,ctx){const explicit=(node.children||[]).filter(x=>x.component==='ds-blocks/c-accordion-item'),items=explicit.length?explicit:(node.attributes?.faqItems||[]).map((x,i)=>({id:`faq-${i}`,attributes:{title:x.title},children:[{component:'core/paragraph',attributes:{content:x.answer||x.content||''},children:[]}]}));const header=(node.children||[]).filter(x=>x.component==='ds-blocks/c-heading').map(x=>renderNode(x,{...ctx,topHeading:true})).join('');return `${header}<div class="dst-accordion">${items.map((item,i)=>{const a=item.attributes||{},answer=(item.children||[]).filter(ch=>ch.component==='core/paragraph').map(ch=>ch.attributes?.content||'').join(' ');return `<details class="dst-accordion__item" ${a.defaultOpen||i===0?'open':''}><summary class="dst-accordion__q"><span class="dst-accordion__q-t">${rich(a.title||`Question ${i+1}`)}</span><span class="dst-accordion__ar is-plus">+</span></summary><div class="dst-accordion__a">${rich(answer)}</div></details>`}).join('')}</div>`}
function renderHorizontalAccordion(node,ctx){const items=node.children||[];return `<div class="sbs-hacc" data-hacc>${items.map((item,i)=>{const a=item.attributes||{};return `<article class="sbs-hacc-item ${i===0?'is-active':''}" data-hacc-item><button data-hacc-button><span>${String(i+1).padStart(2,'0')}</span><b>${rich(a.title||`Item ${i+1}`)}</b></button><div class="sbs-hacc-panel">${a.media?.src?renderMediaValue(a.media,'','3/2'):''}<p>${rich(a.description||'')}</p></div></article>`}).join('')}</div>`}
function renderNode(node,ctx){if(!node)return '';const a=node.attributes||{};switch(node.component){
 case 'ds-blocks/dst-wrapper':{if(ctx.top){const inner=containerClass(ctx.section.layout?.container||node.layout?.container||'default');return `<section id="${escAttr(ctx.section.id)}" class="dst-wrapper c-full ${sectionClasses(ctx.section)} ${sectionBgClass(ctx.section,ctx.sectionIndex)}" ${effectAttrs(ctx.section)}>${renderDecoration(ctx.section)}<div class="dst-wrapper__content"><div class="dst-wrapper__inner ${inner}">${nodeChildren(node,{...ctx,top:false,topHeading:true})}</div></div></section>`}return `<div class="dst-wrapper__inner ${containerClass(node.layout?.container||'default')}">${nodeChildren(node,{...ctx,top:false})}</div>`}
 case 'ds-blocks/dst-banner':{const media=a.backgroundImage?.src?a.backgroundImage:mediaChoice(ctx.section,0),height=ctx.family==='hero'?'bh-full':'bh-md';return `<section id="${escAttr(ctx.section.id)}" class="dst-banner ${height} c-full ${sectionClasses(ctx.section)} ${ctx.family==='hero'?'sbs-hero':''} ${ctx.family==='cta'?'sbs-cta':''}" ${effectAttrs(ctx.section)}>${renderBackground(media,ctx.family)}${renderDecoration(ctx.section)}<div class="dst-banner__container"><div class="dst-banner__inner">${nodeChildren(node,{...ctx,top:false,topHeading:true})}</div></div>${ctx.family==='hero'?'<a class="scroll-down sd-left" href="#'+escAttr(ctx.project.sections[1]?.id||'main')+'"><span>Explore</span><span aria-hidden="true">⌄</span></a>':''}</section>`}
 case 'ds-blocks/c-heading':return renderHeading(node,ctx);
 case 'ds-blocks/button-group':return `<div class="dst-button-group">${nodeChildren(node,ctx)}</div>`;
 case 'ds-blocks/c-btn':return renderButton(node,ctx);
 case 'ds-blocks/simple-text':return `<div class="sbs-rich-text">${nodeChildren(node,ctx)}</div>`;
 case 'core/paragraph':return `<p>${rich(a.content||a.placeholder||'')}</p>`;
 case 'core/list':return `<ul class="sbs-core-list">${nodeChildren(node,ctx)}</ul>`;
 case 'core/list-item':return `<li>${rich(a.content||'')}</li>`;
 case 'core/html':return `<div class="sbs-html-note">${rich(stripHtml(a.content||''))}</div>`;
 case 'ds-blocks/l-content-2':{const media=a.media?.src?a.media:mediaChoice(ctx.section,0),flip=String(a.columnsOrder||'').includes('reverse');return `<div class="dst-content2 ${ctx.top?'c-default':''}"><div class="dst-content2__block ${flip?'sbs-flip':''}"><div class="dst-content2__col sbs-copy-col">${nodeChildren(node,{...ctx,top:false,topHeading:true})}</div><div class="dst-content2__col sbs-media-col">${renderMediaValue(media,'sbs-feature-media','4/3')}</div></div></div>`}
 case 'ds-blocks/ds-columns':{const count=Number(a.desktopColumnsPerRow||a.count||Math.max(1,(node.children||[]).length)),content=`<div class="ds-row" style="grid-template-columns:repeat(${Math.min(count,6)},minmax(0,1fr));gap:${escAttr(a.gap||'3rem')}">${nodeChildren(node,{...ctx,top:false})}</div>`;return ctx.top?`<div class="ds-columns ${containerClass(ctx.section.layout?.container||'default')}">${content}</div>`:`<div class="ds-columns">${content}</div>`}
 case 'ds-blocks/ds-column':return `<div class="ds-column ${a.columnSpan?'has-span':''}" style="${a.columnSpan?`grid-column:span ${Number(a.columnSpan)};`:''}${a.backgroundColor?`background:${escAttr(a.backgroundColor)};`:''}">${nodeChildren(node,{...ctx,nestedHeading:true})}</div>`;
 case 'ds-blocks/c-media':return renderMediaValue(a.media,'','4/3');
 case 'ds-blocks/c-cards':{const slider=!!(a.enableDstSlider||a.enableSlider||a.slider||ctx.family==='slider'||ctx.family==='testimonial'),cols=Number(a.columnsDesktop||a.columns||3),cards=`<div class="dst-cards__grid ${slider?'dst-slider':''} text-left" style="--col:${cols};--col-t:2;--col-m:1;--dst-slider-cols:${Math.min(cols,3)}">${nodeChildren(node,{...ctx,inCards:true})}</div>`;return `<div class="dst-cards ${slider?'has-dst-slider-bleed-right':''}" ${slider?'data-slider':''}>${cards}${slider?`<div class="dst-slider__controls"><div class="dst-slider__progress"><div class="dst-slider__progress-fill"></div></div><div class="dst-slider__nav"><button class="dst-slider__arrows -prev" aria-label="Previous">${ICONS.arrow}</button><button class="dst-slider__arrows -next" aria-label="Next">${ICONS.arrow}</button></div></div>`:''}</div>`}
 case 'ds-blocks/c-card-item':return `<div class="dst-cards__item">${renderCard(node,ctx)}</div>`;
 case 'ds-blocks/c-list':{const timeline=a.layoutVariant==='timeline'||ctx.family==='timeline',cols=timeline?1:Number(a.colCount||1);return `<div class="container no-side-padding dst-list ${timeline?'list-timeline':''}" ${a.heroIsCounter?'data-counter="true"':''}><ul class="dst-list__grid" style="--dst-list__col:${cols};--dst-list__col-tablet:${Math.min(cols,2)};--dst-list__col-mobile:1">${nodeChildren(node,{...ctx,listTimeline:timeline})}</ul></div>`}
 case 'ds-blocks/c-list-item':return renderListItem(node,ctx);
 case 'ds-blocks/ds-tabs':return renderTabs(node,ctx);
 case 'ds-blocks/ds-tab':return nodeChildren(node,ctx);
 case 'ds-blocks/c-accordion':return renderAccordion(node,ctx);
 case 'ds-blocks/c-accordion-item':return '';
 case 'ds-blocks/dst-hacc':return renderHorizontalAccordion(node,ctx);
 case 'ds-blocks/dst-hacc-item':return '';
 case 'ds-blocks/marquee':{const logos=a.images||[];const all=[...logos,...logos];return `<div class="dst-marquee"><div class="dst-marquee__track" style="--dur:28s">${all.map(x=>x.src?`<img class="dst-marquee__img" src="${escAttr(x.src)}" alt="${escAttr(x.alt||'Logo')}">`:`<span class="dst-marquee__logo">${esc(x.label||x.alt||'WORDMARK')}</span>`).join('')}</div></div>`}
 case 'gravityforms/form':return `<div class="sbs-form-slot" id="contact"><div class="sbs-form-slot__head"><span>Gravity Forms</span><b>Production form slot</b></div><div class="sbs-form-mock" aria-hidden="true"><span></span><span></span><span class="wide"></span><i>Submit</i></div><p>${esc(a.placeholder||'Connect the production form in WordPress.')}</p></div>`;
 case 'ds-blocks/dst-banner-slider':{return `<div class="sbs-banner-slider" data-slider>${nodeChildren(node,ctx)}</div>`}
 case 'ds-blocks/dst-banner-slide':return `<div class="sbs-banner-slide">${nodeChildren(node,ctx)}</div>`;
 default:return nodeChildren(node,ctx);
 }}
function effectAttrs(section){const e=section.effects||{};const parts=[];if(e.viewport)parts.push(`data-viewport="true" data-viewport-effect="${escAttr(e.viewport)}"`);if(e.scroll)parts.push(`data-scroll="true" data-scroll-effect="${escAttr(e.scroll)}"`);return parts.join(' ')}
function renderSection(section,index,project){ensureSectionSettings(section);syncSectionNode(section);const ctx={section,sectionIndex:index,project,family:section.family,top:true,topHeading:true,h1Used:false,nestedHeading:false};if(['ds-blocks/dst-wrapper','ds-blocks/dst-banner'].includes(section.node.component))return renderNode(section.node,ctx);return `<section id="${escAttr(section.id)}" class="dst-wrapper c-full ${sectionClasses(section)} ${sectionBgClass(section,index)}" ${effectAttrs(section)}>${renderDecoration(section)}<div class="dst-wrapper__inner ${containerClass(section.layout?.container||'default')}">${renderNode(section.node,{...ctx,top:false})}</div></section>`}
function renderHeader(project){const h=project.header,b=project.brief;return `<header class="site-header is-sticky has-glass"><div class="site-header__row c-default"><a class="site-header__logo" href="#top"><span class="sbs-logo-mark">VC</span><span>${esc(h.logoText||b.clientName)}</span></a><button class="sbs-menu-toggle" aria-expanded="false" aria-label="Open navigation"><span></span><span></span><span></span></button><nav class="nav-menu">${(h.nav||[]).map(([label,url])=>`<a href="${escAttr(normalizeLink(url))}">${esc(label)}</a>`).join('')}</nav><a class="c-btn -primary -small sbs-header-cta" href="${escAttr(normalizeLink(h.cta?.link||'#contact'))}">${esc(h.cta?.text||'Contact')}</a></div></header>`}
function renderFooter(project){const f=project.footer,b=project.brief;return `<footer class="site-footer is-style-colors-inverted sbs-footer"><div class="c-default"><div class="footer__top sbs-footer-statement"><span class="c-heading__pre">${esc(b.clientName)}</span><h2 class="footer__nl-head">${rich(f.statement)}</h2><p class="footer__nl-sub">${rich(f.description)}</p><a class="c-btn -primary-inverted" href="#contact">Start a conversation <span aria-hidden="true">↗</span></a></div><div class="footer__divider"></div><div class="footer__cols"><div class="footer__col"><div class="site-header__logo sbs-footer-logo"><span class="sbs-logo-mark">VC</span><span>${esc(b.clientName)}</span></div><p>${rich(b.offer)}</p><div class="dst-socials"><a class="dst-social" href="#" aria-label="LinkedIn">in</a><a class="dst-social" href="#" aria-label="Email">@</a></div></div>${(f.columns||[]).map(col=>`<div class="footer__col"><h4>${esc(col.title)}</h4><ul class="footer__menu">${(col.links||[]).map(([l,u])=>`<li><a href="${escAttr(normalizeLink(u))}">${esc(l)}</a></li>`).join('')}</ul></div>`).join('')}</div><div class="footer__bottom"><div class="footer__legal">${esc(f.legal)}</div><ul class="footer__privacy"><li><a href="#privacy">Privacy</a></li><li><a href="#accessibility">Accessibility</a></li></ul></div></div><div class="footer__wordmark is-bottom" aria-hidden="true">${esc(b.clientName.split(' ')[0]||'SBS')}</div></footer>`}
/*
 * `--sbs-on-white` is the label for a fill that is actually white.
 *
 * Several button families invert on hover by flooding the shape with `#fff`
 * and then setting the label to `--dst--primary-color3`, the ink role — which
 * is dark only when the palette is light. On a dark palette ink *is* the light
 * colour, so the hover painted a light label on a white fill: 1.2:1, measured
 * on five of the ten families. A fill of a known colour needs a label chosen
 * for that colour, not for a role that changes tone with the palette.
 */
function siteCss(project){const d=project.design,p=d.palette,onAccent=readableOn(p.accent,['#ffffff',p.ink,p.dark]),onInk=readableOn(p.ink,['#ffffff',p.bg,p.soft]),onDark=readableOn(p.dark,['#ffffff',p.bg,p.soft]),onWhite=readableOn('#ffffff',[p.dark,p.ink,p.accent]),vg=(6.8+(d.density/100)*4.2).toFixed(2),h1=(5.8+(d.expressiveness/100)*2.5).toFixed(2),motion=(.55+(d.motion/100)*.55).toFixed(2);return `
html{scroll-behavior:smooth;background:${p.bg}}body{margin:0;background:${p.bg};overflow-x:clip}#sbs-site.ver{display:block;min-height:100vh;--dst--primary-color1:${p.dark};--dst--primary-color2:${p.accent};--dst--primary-color3:${p.ink};--dst--secondary-color1:#fff;--dst--secondary-color2:${p.bg};--dst--secondary-color3:${p.soft};--dst--secondary-color4:${p.accent};--dst--secondary-color5:${p.soft};--dst--secondary-color6:${p.accent};--dst--secondary-color7:#fff;--dst--secondary-color8:${p.accent};--dst--body-bg:${p.bg};--dst--body-bg-alt:${p.dark};--dst--base-text-color:${p.ink};--dst--base-text-color-alt:#f7f5ef;--dst--base-heading-color:${p.ink};--dst--base-heading-color-alt:#fff;--dst--base-link-color:${p.accent};--dst--base-link-color-alt:#f7f5ef;--dst--border-color:${p.soft};--dst--border-color-alt:rgba(255,255,255,.18);--dst--pretitle-color:${p.accent};--dst--pretitle-color-alt:#fff;--dst--subtitle-color:${p.ink};--dst--subtitle-color-alt:rgba(255,255,255,.78);--dst--font-primary:'${d.fontBody}',system-ui,sans-serif;--dst--font-secondary:'${d.fontDisplay}',Georgia,serif;--dst--fs-h1:clamp(4.2rem,${h1}vw,10.2rem);--dst--fs-h2:clamp(3.2rem,4.4vw,7rem);--dst--fs-h3:clamp(2.2rem,2.2vw,3.6rem);--dst--fs-h4:clamp(1.8rem,1.5vw,2.4rem);--dst--fs-pretitle:clamp(1.1rem,.4vw + 1rem,1.4rem);--dst--fs-subtitle:clamp(1.8rem,.5vw + 1.55rem,2.2rem);--dst--fs-base:clamp(1.6rem,.15vw + 1.55rem,1.8rem);--dst--fs-lg:clamp(1.9rem,.3vw + 1.7rem,2.3rem);--dst--base-lh:1.65;--dst--default-radius:${d.radius};--dst--default-container-width:1440px;--dst--wide-container-width:1780px;--dst--alt-container-width:1060px;--dst--desktop-vertical-gap:${vg}vmin;--dst--vgap-s:5.2vmin;--dst--vgap-l:13vmin;--dst--header-height:84px;--sbs-on-accent:${onAccent};--sbs-on-ink:${onInk};--sbs-on-dark:${onDark};--sbs-on-white:${onWhite};--dst--btn-ff:var(--dst--font-primary);--dst--btn-br:${d.radius};--dst--btn-p:1.55rem 2.7rem;--dst--btn-fs:1.5rem;--dst--btn-fw:650;--dst--btn-primary-c:${onAccent};--dst--btn-primary-bg:${p.accent};--dst--btn-primary-bdc:${p.accent};--dst--btn-primary-c-hover:${onDark};--dst--btn-primary-bg-hover:${p.dark};--dst--btn-secondary-c:${p.ink};--dst--btn-secondary-bg:transparent;--dst--btn-secondary-bdc:${p.ink};--dst--btn-secondary-c-hover:${onInk};--dst--btn-secondary-bg-hover:${p.ink};--dst--btn-secondary-inverted-c:#fff;--dst--btn-secondary-inverted-bdc:rgba(255,255,255,.65);--dst--btn-secondary-inverted-bg-hover:#fff;--dst--btn-secondary-inverted-c-hover:${p.dark};--dst--btn-primary-inverted-c:${p.dark};--dst--btn-primary-inverted-bg:#fff;--dst--btn-primary-inverted-bg-hover:${p.accent};--dst--btn-primary-inverted-c-hover:${onAccent};font-family:var(--dst--font-primary);font-size:var(--dst--fs-base);color:var(--dst--base-text-color);background:var(--dst--body-bg)}
#sbs-site *{box-sizing:border-box}#sbs-site a{transition:color .2s ease,background-color .2s ease,border-color .2s ease,transform .2s ease}#sbs-site h1,#sbs-site h2,#sbs-site h3,#sbs-site h4{font-weight:600}#sbs-site .c-heading__title{letter-spacing:-.035em;text-wrap:balance}#sbs-site .c-heading__sub{opacity:.83}#sbs-site .c-heading__pre{font-family:var(--dst--font-primary);font-weight:700;letter-spacing:.18em}#sbs-site .c-heading__description{gap:2.3rem}#sbs-site .sbs-rich-text{max-width:66ch}#sbs-site .sbs-rich-text p{font-size:var(--dst--fs-lg);line-height:1.62;margin:0;color:inherit;opacity:.88}#sbs-site .c-heading.text-center .sbs-rich-text{margin-inline:auto}#sbs-site .c-heading.text-center .sbs-rich-text p{margin-inline:auto}
.site-header{background:color-mix(in srgb,${p.bg} 90%,transparent);border-bottom:1px solid color-mix(in srgb,${p.ink} 11%,transparent);transition:background .25s,box-shadow .25s}.site-header.is-stuck{background:color-mix(in srgb,${p.bg} 97%,transparent);box-shadow:0 8px 30px rgba(7,28,42,.07)}.site-header__row{min-height:84px;padding-block:1.2rem}.site-header__logo{display:inline-flex;align-items:center;gap:1rem;text-decoration:none;font-family:var(--dst--font-primary);font-size:1.65rem;letter-spacing:-.01em}.sbs-logo-mark{width:3.8rem;height:3.8rem;display:grid;place-items:center;background:${p.dark};color:#fff;font-size:1.05rem;letter-spacing:.06em;font-weight:800}.nav-menu{gap:3rem}.nav-menu a{font-size:1.45rem;font-weight:600}.sbs-header-cta{margin-left:1rem}.sbs-menu-toggle{display:none;width:4.2rem;height:4.2rem;border:0;background:transparent;margin-left:auto;padding:1rem}.sbs-menu-toggle span{display:block;width:100%;height:1px;background:currentColor;margin:.7rem 0}
.sbs-band-paper{background:${p.bg}}.sbs-band-soft{background:color-mix(in srgb,${p.soft} 58%,${p.bg})}.sbs-band-tint{background:color-mix(in srgb,${p.accent} 5%,${p.bg})}.sbs-band-dark{background:${p.dark}}.dst-wrapper{position:relative}.dst-wrapper__content,.dst-wrapper__inner{position:relative;z-index:1}.dst-wrapper.c-full>.dst-wrapper__content>.dst-wrapper__inner{width:100%}.dst-wrapper>.c-decoration{z-index:0}.c-decoration{overflow:hidden}.dst-deco--cover{inset:0}.dst-deco--top,.dst-deco--bottom{height:24rem}.dst-deco--center{width:55vmin;height:55vmin}.dst-deco--top-left,.dst-deco--top-right,.dst-deco--bottom-left,.dst-deco--bottom-right{width:min(34rem,32vw);height:min(34rem,32vw)}
.dst-banner{min-height:62rem}.dst-banner__container{padding-block:clamp(8rem,12vw,18rem)}.sbs-hero{min-height:calc(100vh - 84px);background:${p.dark};isolation:isolate;color:#fff}.sbs-hero .c-bg{left:auto;width:62%;z-index:0}.sbs-hero .c-bg__layer{object-position:center;filter:saturate(.64) contrast(1.06)}.sbs-hero .c-overlay{background:linear-gradient(90deg,${p.dark} 0%,${p.dark} 39%,color-mix(in srgb,${p.dark} 78%,transparent) 60%,transparent 88%)}.sbs-hero .dst-banner__container{align-items:flex-start;justify-content:center}.sbs-hero .dst-banner__inner{max-width:min(74rem,56vw)}.sbs-hero .c-heading__title{max-width:20ch}.sbs-hero .c-heading__sub{max-width:59ch}.sbs-hero .dst-button-group{margin-top:1rem}.sbs-hero .scroll-down{color:#fff;text-decoration:none}.sbs-hero .scroll-down:after{content:"";width:1px;height:4.8rem;background:currentColor;opacity:.45;margin-top:.5rem}.sbs-cta{background:${p.dark};color:#fff;min-height:64rem}.sbs-cta .c-bg{opacity:.34}.sbs-cta .c-bg__layer{filter:grayscale(.55);object-position:center}.sbs-cta .c-overlay{background:linear-gradient(90deg,${p.dark} 0%,color-mix(in srgb,${p.dark} 94%,transparent) 47%,color-mix(in srgb,${p.dark} 40%,transparent) 100%)}.sbs-cta .dst-banner__inner{max-width:78rem}.sbs-cta .c-heading__title{font-size:clamp(4rem,6vw,8.5rem)}
.c-btn{gap:.9rem;text-decoration:none;position:relative}.c-btn:hover{transform:translateY(-2px)}.sbs-btn-arrow{font-size:1.05em}.dst-button-group{gap:1rem}.c-btn.-link{text-decoration:none;border-bottom:1px solid currentColor}.c-btn.-link:hover{transform:none;opacity:.7}
.dst-content2__block{gap:clamp(4rem,7vw,11rem);align-items:center}.dst-content2__block.sbs-flip{flex-direction:row-reverse}.dst-content2__col.sbs-copy-col{flex:0 1 46%}.dst-content2__col.sbs-media-col{flex:1 1 54%}.sbs-feature-media{--ar:4/3;min-height:48rem}.sbs-feature-media img{filter:saturate(.78)}.sbs-feature-media:after{content:"";position:absolute;inset:1.8rem -1.8rem -1.8rem 1.8rem;border:1px solid color-mix(in srgb,${p.accent} 55%,transparent);z-index:-1;pointer-events:none}
.ds-row{align-items:stretch}.ds-column{min-width:0}.ds-column[style*="background"]{padding:clamp(2.5rem,3vw,4.8rem);border:1px solid color-mix(in srgb,${p.ink} 12%,transparent)}.is-style-colors-inverted .ds-column[style*="background"]{color:#fff}.is-style-colors-inverted .ds-column[style*="background"] h3,.is-style-colors-inverted .ds-column[style*="background"] p,.is-style-colors-inverted .ds-column[style*="background"] li{color:inherit}
.dst-cards__grid{gap:clamp(1.5rem,2vw,3rem)}.dst-cards__item{min-height:100%}.c-block{height:100%;border:1px solid color-mix(in srgb,${p.ink} 13%,transparent);background:color-mix(in srgb,#fff 68%,${p.bg});overflow:hidden;padding:clamp(2.4rem,3vw,4rem)}.c-block:hover{border-color:color-mix(in srgb,${p.accent} 70%,transparent);transform:translateY(-4px)}.dst-card--media-top{padding:0}.dst-card--media-top .c-block__media{margin:0}.dst-card--media-top .c-block__body{padding:clamp(2rem,2.4vw,3.2rem)}.dst-card--media-top .ph{border-radius:0;border:0}.dst-card--media-background{min-height:42rem;border:0;color:#fff}.dst-card--media-background>.c-block__media{inset:0}.dst-card--media-background .ph{height:100%;border:0;border-radius:0;aspect-ratio:auto}.dst-card--media-background .c-block__scrim{background:linear-gradient(180deg,rgba(7,28,42,.02),rgba(7,28,42,.92));z-index:1}.dst-card--media-background>.c-block__body{padding:3rem;bottom:0}.dst-card--media-background .c-block__title,.dst-card--media-background .c-block__description{color:#fff}.dst-card--media-background .c-block__description{opacity:.83}.c-block__title{font-family:var(--dst--font-secondary);font-size:clamp(2.2rem,2vw,3rem);line-height:1.12}.c-block__description{font-size:1.55rem}.c-block__tagline{font-weight:700}.sbs-gallery-card{border:0;background:transparent}.sbs-gallery-card .c-block__body{padding:1.4rem 0}.sbs-gallery-card:hover{transform:none}.sbs-gallery-card .ph{transition:transform .65s cubic-bezier(.2,.7,.2,1)}.sbs-gallery-card:hover .ph{transform:scale(.985)}
.sbs-quote-card{padding:clamp(3.2rem,5vw,7.2rem);background:transparent;border-top:1px solid color-mix(in srgb,${p.ink} 20%,transparent);border-right:0;border-bottom:0;border-left:0}.sbs-quote-card:hover{transform:none;border-color:${p.accent}}.sbs-quote-mark{font-family:Georgia,serif;font-size:9rem;line-height:.5;color:${p.accent};opacity:.7}.sbs-quote-card blockquote{font-family:var(--dst--font-secondary);font-size:clamp(2.8rem,3.4vw,5.2rem);line-height:1.18;max-width:27ch;margin:2rem 0 4rem;color:${p.ink}}.c-quote__photo{width:5.4rem;height:5.4rem;border-radius:50%;overflow:hidden}.c-quote__photo .ph{height:100%;border:0}.c-quote__author b{font-size:1.5rem}.c-quote__author span{font-size:1.25rem;opacity:.65}
.dst-list__grid{gap:2rem}.dst-list__item{align-items:flex-start}.dst-list__media .sbs-check{width:2.5rem;height:2.5rem;border:1px solid color-mix(in srgb,${p.accent} 55%,transparent);border-radius:50%;font-size:1.2rem;display:grid;place-items:center}.dst-list__title{font-family:var(--dst--font-primary);font-size:1.8rem}.dst-list__description{font-size:1.5rem}.sbs-stat-value{font-size:clamp(4.8rem,5vw,8rem);min-width:auto;color:${p.accent};letter-spacing:-.06em}.dst-list[data-counter] .dst-list__item{display:block;padding-top:2rem;border-top:1px solid color-mix(in srgb,${p.ink} 18%,transparent)}.dst-list[data-counter] .dst-list__hero{margin-bottom:2rem}.list-timeline{max-width:82rem;margin-inline:0}.list-timeline .dst-list__item{padding-bottom:4.8rem}.list-timeline .dst-list__hero{font-size:1.35rem;font-family:var(--dst--font-primary);font-weight:700;letter-spacing:.1em;color:${p.accent};min-width:6rem}.list-timeline .dst-list__title{font-family:var(--dst--font-secondary);font-size:clamp(2.4rem,2.3vw,3.4rem)}.list-timeline .dst-list__description{font-size:1.7rem;max-width:50ch}
.dst-marquee{border-block:1px solid color-mix(in srgb,${p.ink} 12%,transparent);padding-block:3.4rem}.dst-marquee__track{gap:7rem}.dst-marquee__logo{font-family:var(--dst--font-primary);font-size:1.25rem;letter-spacing:.18em;font-weight:800;opacity:.45}
.sbs-tabs .dst-tabs__navbar{justify-content:flex-start;margin-bottom:3rem;border-bottom:1px solid color-mix(in srgb,${p.ink} 15%,transparent);gap:0}.sbs-tab-button{border:0;border-radius:0!important;background:transparent!important;color:${p.ink}!important;padding:1.5rem 2rem!important;border-bottom:2px solid transparent!important}.sbs-tab-button.is-active{border-bottom-color:${p.accent}!important;color:${p.accent}!important}.sbs-tab-panel{display:none!important;border:0;background:transparent;padding:0;min-height:0}.sbs-tab-panel.is-active{display:block!important}.sbs-tab-panel .ds-row{grid-template-columns:minmax(0,1.1fr) minmax(28rem,.9fr)!important;gap:clamp(3rem,6vw,9rem)!important;align-items:center}.sbs-tab-panel .ph{min-height:35rem}
.dst-accordion{border-top:1px solid color-mix(in srgb,${p.ink} 18%,transparent)}.dst-accordion__item{border-bottom:1px solid color-mix(in srgb,${p.ink} 18%,transparent)}.dst-accordion__q{padding:2.2rem 0;font-family:var(--dst--font-secondary);font-size:clamp(2rem,2vw,2.8rem)}.dst-accordion__a{padding:0 5rem 2.5rem 0;font-size:1.65rem}.dst-accordion__ar{color:${p.accent};font-size:2.6rem}.sbs-hacc{display:flex;min-height:58rem;overflow:hidden;border:1px solid color-mix(in srgb,${p.ink} 15%,transparent)}.sbs-hacc-item{flex:0 0 8rem;display:flex;overflow:hidden;border-right:1px solid color-mix(in srgb,${p.ink} 15%,transparent);transition:flex .55s cubic-bezier(.2,.7,.2,1);background:${p.bg}}.sbs-hacc-item.is-active{flex:1}.sbs-hacc-item>button{width:8rem;flex:0 0 8rem;border:0;background:transparent;padding:2rem 1.4rem;display:flex;flex-direction:column;align-items:center;gap:2rem;cursor:pointer}.sbs-hacc-item>button span{font:600 1.1rem DM Mono,monospace;color:${p.accent}}.sbs-hacc-item>button b{writing-mode:vertical-rl;transform:rotate(180deg);font-size:1.35rem;letter-spacing:.06em;text-transform:uppercase}.sbs-hacc-panel{min-width:min(64rem,65vw);padding:3rem;display:grid;grid-template-columns:1.3fr .7fr;gap:3rem;align-items:end}.sbs-hacc-panel .ph{height:100%}.sbs-hacc-panel p{font-family:var(--dst--font-secondary);font-size:3rem}
.dst-cards__grid.dst-slider{padding-bottom:1rem}.dst-slider__controls{justify-content:flex-end}.dst-slider__progress{max-width:28rem}.dst-slider__arrows{border:1px solid color-mix(in srgb,${p.ink} 15%,transparent);box-shadow:none}.dst-slider__arrows:hover{background:${p.dark};color:#fff}.dst-slider__progress-fill{transform:scaleX(.34)}
.sbs-core-list{list-style:none;padding:0;margin:2.4rem 0;display:flex;flex-direction:column;gap:1rem}.sbs-core-list li{position:relative;padding-left:2.2rem;font-size:1.55rem}.sbs-core-list li:before{content:"✓";position:absolute;left:0;color:${p.accent};font-weight:700}.sbs-form-slot{background:#fff;color:${p.ink};padding:clamp(2.5rem,4vw,5rem);border:1px solid color-mix(in srgb,${p.ink} 14%,transparent);min-height:38rem}.sbs-form-slot__head span{display:block;color:${p.accent};font-size:1.1rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.sbs-form-slot__head b{display:block;font-family:var(--dst--font-secondary);font-size:3.2rem;margin-top:.7rem}.sbs-form-mock{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:3rem 0 1.5rem}.sbs-form-mock span{height:5rem;border:1px solid color-mix(in srgb,${p.ink} 18%,transparent);background:${p.bg}}.sbs-form-mock span.wide{grid-column:1/-1;height:10rem}.sbs-form-mock i{display:grid;place-items:center;height:5rem;background:${p.accent};color:#fff;font-style:normal;font-size:1.4rem;font-weight:700}.sbs-form-slot p{font-size:1.2rem;opacity:.6}
.sbs-footer{background:${p.dark};overflow:hidden;position:relative}.sbs-footer>.c-default{position:relative;z-index:2}.sbs-footer-statement{display:block;max-width:105rem;padding-bottom:clamp(5rem,8vw,11rem)}.sbs-footer-statement .footer__nl-head{font-family:var(--dst--font-secondary);font-size:clamp(4rem,7vw,10rem);line-height:.97;letter-spacing:-.045em;max-width:12ch}.sbs-footer-statement .footer__nl-sub{max-width:55ch;font-size:1.8rem;margin:2rem 0 3rem}.footer__divider{height:1px;background:rgba(255,255,255,.17);margin-bottom:5rem}.sbs-footer .footer__cols{grid-template-columns:1.5fr 1fr 1fr}.sbs-footer-logo{color:#fff;margin-bottom:2rem}.sbs-footer .footer__col p{max-width:35ch}.sbs-footer .footer__bottom{padding-top:4rem;border-top:1px solid rgba(255,255,255,.17)}.sbs-footer .footer__wordmark{color:rgba(255,255,255,.035);font-family:var(--dst--font-secondary)}
[data-viewport]{transition-duration:${motion}s}.has-inview-a [data-viewport-effect].in-view>*{opacity:1;transform:none}.has-inview-a [data-viewport-effect="animate-headings"].in-view .c-heading__title{transition-delay:.12s}
@media(max-width:1100px){.nav-menu{gap:1.7rem}.sbs-hero .c-bg{width:64%}.sbs-hero .dst-banner__inner{max-width:62vw}.dst-content2__block{gap:4rem}.sbs-feature-media{min-height:38rem}.sbs-hacc{min-height:48rem}}
@media(max-width:900px){.site-header__row{min-height:70px}#sbs-site .site-header.header-stacked .site-header__row{display:flex;grid-template-areas:none}#sbs-site .site-header.header-floating{padding:0}#sbs-site .site-header.header-floating .site-header__row{border:0;border-radius:0;box-shadow:none;background:transparent;padding-inline:2rem}.sbs-footer.footer-columns>.c-default{display:block}.sbs-menu-toggle{display:block}.nav-menu{display:none;position:absolute;left:0;right:0;top:100%;background:${p.bg};padding:2rem 2.4rem 3rem;border-bottom:1px solid color-mix(in srgb,${p.ink} 12%,transparent);flex-direction:column;align-items:flex-start}.site-header.menu-open .nav-menu{display:flex}.sbs-header-cta{display:none}.sbs-hero{min-height:auto}.sbs-hero .c-bg{inset:0;width:100%;opacity:.24}.sbs-hero .c-overlay{background:linear-gradient(180deg,${p.dark} 0%,color-mix(in srgb,${p.dark} 84%,transparent) 65%,${p.dark} 100%)}.sbs-hero .dst-banner__inner{max-width:100%}.sbs-hero .dst-banner__container{padding-top:10rem;padding-bottom:13rem}.sbs-hero .c-heading__title{max-width:13ch}.dst-content2__block,.dst-content2__block.sbs-flip{flex-direction:column}.dst-content2__col.sbs-copy-col,.dst-content2__col.sbs-media-col{flex:1 1 auto;width:100%}.sbs-feature-media{min-height:0}.sbs-tab-panel .ds-row{grid-template-columns:1fr!important}.sbs-hacc{display:block;min-height:0}.sbs-hacc-item{display:block;flex:none;border-right:0;border-bottom:1px solid color-mix(in srgb,${p.ink} 15%,transparent)}.sbs-hacc-item>button{width:100%;height:auto;flex-direction:row;padding:1.8rem 2rem}.sbs-hacc-item>button b{writing-mode:horizontal-tb;transform:none}.sbs-hacc-panel{display:none;min-width:0;padding:2rem;grid-template-columns:1fr}.sbs-hacc-item.is-active .sbs-hacc-panel{display:grid}.sbs-footer .footer__cols{grid-template-columns:1fr 1fr}.dst-cards__grid.dst-slider>*{flex-basis:78%}}
@media(max-width:680px){.c-default,.c-alt,.c-wide,.container{padding-inline:2rem}.dt,.dt-l{padding-top:6.4rem}.db,.db-l{padding-bottom:6.4rem}.site-header__row{padding-inline:1.8rem}.sbs-logo-mark{width:3.4rem;height:3.4rem}.sbs-hero .dst-banner__container,.sbs-cta .dst-banner__container{padding-inline:2rem}.sbs-hero .c-heading__title{font-size:clamp(4.2rem,15vw,7rem)}.dst-button-group{flex-direction:column;align-items:stretch}.dst-button-group .c-btn{width:100%}.dst-list[data-counter] .dst-list__grid{grid-template-columns:1fr 1fr!important}.dst-list[data-counter] .dst-list__item{padding-right:1rem}.sbs-stat-value{font-size:4.5rem}.sbs-tabs .dst-tabs__navbar{overflow-x:auto;flex-wrap:nowrap;justify-content:flex-start}.sbs-tab-button{white-space:nowrap}.sbs-quote-card{padding-inline:0}.sbs-quote-card blockquote{font-size:3rem}.sbs-footer .footer__cols{grid-template-columns:1fr}.sbs-footer-statement .footer__nl-head{font-size:5rem}.footer__privacy{width:100%}.dst-cards__grid.dst-slider>*{flex-basis:88%}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}#sbs-site *,#sbs-site *:before,#sbs-site *:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}.has-inview-a [data-viewport-effect]>*,.has-inview-a [data-scroll]>*{opacity:1!important;transform:none!important;visibility:visible!important;clip-path:none!important}}
`}
function siteRuntime(){return `
(function(){
  var header=document.querySelector('.site-header');
  function stuck(){if(header)header.classList.toggle('is-stuck',window.scrollY>14)}
  stuck();window.addEventListener('scroll',stuck,{passive:true});
  var toggle=document.querySelector('.sbs-menu-toggle');
  if(toggle&&header)toggle.addEventListener('click',function(){var open=header.classList.toggle('menu-open');toggle.setAttribute('aria-expanded',String(open))});
  document.querySelectorAll('.nav-menu a,.scroll-down').forEach(function(a){a.addEventListener('click',function(){if(header)header.classList.remove('menu-open')})});
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var targets=document.querySelectorAll('[data-viewport]');
  if(reduce||!('IntersectionObserver' in window)){targets.forEach(function(el){el.classList.add('in-view')})}else{
    var io=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add('in-view');if(entry.target.dataset.viewportRepeat!=='true')io.unobserve(entry.target)}})},{threshold:.12,rootMargin:'0px 0px -6% 0px'});
    targets.forEach(function(el){io.observe(el)});
  }
  document.querySelectorAll('[data-tabs]').forEach(function(tabs){var buttons=tabs.querySelectorAll('[data-tab-index]'),panels=tabs.querySelectorAll('.sbs-tab-panel');buttons.forEach(function(btn){btn.addEventListener('click',function(){var n=Number(btn.dataset.tabIndex);buttons.forEach(function(b,i){b.classList.toggle('is-active',i===n);b.setAttribute('aria-selected',String(i===n))});panels.forEach(function(p,i){p.classList.toggle('is-active',i===n)})})})});
  document.querySelectorAll('[data-hacc]').forEach(function(root){root.querySelectorAll('[data-hacc-button]').forEach(function(btn){btn.addEventListener('click',function(){var item=btn.closest('[data-hacc-item]');root.querySelectorAll('[data-hacc-item]').forEach(function(x){x.classList.toggle('is-active',x===item)})})})});
  document.querySelectorAll('[data-slider]').forEach(function(slider){var track=slider.querySelector('.dst-slider'),prev=slider.querySelector('.-prev'),next=slider.querySelector('.-next'),fill=slider.querySelector('.dst-slider__progress-fill');if(!track)return;function amount(){return Math.max(280,track.clientWidth*.72)}function update(){var max=track.scrollWidth-track.clientWidth,p=max?track.scrollLeft/max:0;if(fill)fill.style.transform='scaleX('+Math.max(.08,p)+')';if(prev)prev.setAttribute('aria-disabled',String(track.scrollLeft<4));if(next)next.setAttribute('aria-disabled',String(track.scrollLeft>max-4))}if(prev)prev.addEventListener('click',function(){track.scrollBy({left:-amount(),behavior:reduce?'auto':'smooth'})});if(next)next.addEventListener('click',function(){track.scrollBy({left:amount(),behavior:reduce?'auto':'smooth'})});track.addEventListener('scroll',update,{passive:true});update()});
  document.querySelectorAll('a[href^="#"]').forEach(function(a){a.addEventListener('click',function(e){var id=a.getAttribute('href');if(id&&id.length>1){var target=document.querySelector(id);if(target){e.preventDefault();target.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'})}}})});
})();`}
function buildSiteDocument(project){project.sections.forEach(syncSectionNode);const b=project.brief,title=`${b.projectName} — ${b.goal.split(' ').slice(0,7).join(' ')}`,families=[project.design.fontBody,project.design.fontDisplay].filter((x,i,a)=>a.indexOf(x)===i).map(f=>`family=${encodeURIComponent(f).replace(/%20/g,'+')}:wght@400;500;600;700`).join('&');const sections=project.sections.filter(s=>s.visible!==false).map((s,i)=>renderSection(s,i,project)).join('');return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${esc(title)}</title><meta name="description" content="${escAttr(b.goal)}"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?${families}&display=swap" rel="stylesheet"><style>${DST_SHARED_CSS}\n${siteCss(project)}</style></head><body class="has-inview-a"><div id="top"></div><main class="ver active" id="sbs-site">${renderHeader(project)}${sections}${renderFooter(project)}</main><script>${siteRuntime()}<\/script></body></html>`}

const EXPORT_HOC_KEYS=new Set(['dsContainer','dsPadding','dsMargin','dsEffects']);
const EXPORT_TRIGGER_EFFECTS=new Set(['','fade','fade-up','fade-down','fade-right','fade-left','zoom-in','slide-up','slide-down','slide-right','slide-left','fade-in-seq','fade-in-slides','animate-headings','custom']);
const EXPORT_SCRUB_EFFECTS=new Set(['parallax-up','parallax-down','parallax-bg','bg-zoom-in','bg-zoom-out','scroll-fade','fade-scrub','reveal','zoom-scrub','rotate-scrub','cascade','stack-cards','highlight','progress-x','custom']);
function cleanEscapedString(value){return String(value).replace(/\\u([0-9a-fA-F]{4})/g,(_,hex)=>String.fromCharCode(parseInt(hex,16)))}
function cleanExportValue(value){if(Array.isArray(value))return value.map(cleanExportValue);if(value&&typeof value==='object'){const out={};for(const [k,v] of Object.entries(value))out[k]=cleanExportValue(v);return out}return typeof value==='string'?cleanEscapedString(value):value}
function exportContainer(value,fallback='default'){const v=String(value||'').trim();if(!v)return fallback;if(['container-alt','alt'].includes(v))return 'alt';if(['container-fluid','full','no-container'].includes(v))return 'full';if(['container-wide','wide'].includes(v))return 'wide';return 'default'}
function exportSpacing(value,fallback={top:'default',bottom:'default'}){if(!value||typeof value!=='object')return {...fallback};const side=name=>{const v=value[name];if(v&&typeof v==='object')return v.type||v.desktop||fallback[name]||'default';return typeof v==='string'&&v?v:(fallback[name]||'default')};return {top:side('top'),bottom:side('bottom')}}
function exportMargin(value){if(!value||typeof value!=='object')return undefined;const out={};for(const side of ['top','right','bottom','left']){const v=value[side];if(v&&typeof v==='object')out[side]=v.type||v.desktop||'';else if(v!=null&&v!=='')out[side]=v}return Object.keys(out).length?out:undefined}
function normalizeExportEffects(value){if(!value||typeof value!=='object'||!Object.keys(value).length)return undefined;const fx=cleanExportValue(value),mode=fx.mode==='scrub'?'scrub':'trigger';fx.mode=mode;fx.type=String(fx.type||'');if(mode==='scrub'){if(!EXPORT_SCRUB_EFFECTS.has(fx.type))fx.type='reveal';fx.fallback=EXPORT_TRIGGER_EFFECTS.has(String(fx.fallback||''))?String(fx.fallback||'fade-up'):'fade-up';if(fx.range!=null&&typeof fx.range!=='string')delete fx.range}else if(!EXPORT_TRIGGER_EFFECTS.has(fx.type))fx.type='fade-up';fx.repeat=!!fx.repeat;const threshold=Number(fx.threashold);fx.threashold=Number.isFinite(threshold)?clamp(threshold,0,1):.15;fx.margin=typeof fx.margin==='string'?fx.margin:'';fx.custom=typeof fx.custom==='string'?fx.custom:'';if(fx.type==='custom'&&!fx.custom)fx.type=mode==='scrub'?'reveal':'fade-up';return fx}
function zeroBox(){return {top:'0rem',right:'0rem',bottom:'0rem',left:'0rem'}}
function mandatoryExportValue(desc,attrs,index=0){const name=desc.name;if(name==='backtitle')return '';if(name==='gapTablet'||name==='gapMobile')return attrs.gap||'2rem';if(name==='columnsTablet')return Math.min(2,Number(attrs.columnsDesktop||attrs.columns||3)||2);if(name==='columnsMobile')return 1;if(name==='gapVerticalTablet'||name==='gapHorizontalTablet')return attrs.gapVertical||attrs.gapHorizontal||'2rem';if(name==='gapVerticalMobile'||name==='gapHorizontalMobile')return '1.6rem';if(name==='cardItemPaddingTablet')return cleanExportValue(attrs.cardItemPadding||zeroBox());if(name==='cardItemPaddingMobile')return cleanExportValue(attrs.cardItemPaddingMobile||attrs.cardItemPadding||zeroBox());if(name==='bodyPaddingTablet')return cleanExportValue(attrs.bodyPadding||zeroBox());if(name==='bodyPaddingMobile')return cleanExportValue(attrs.bodyPaddingMobile||attrs.bodyPadding||zeroBox());if(name==='allowedBlocks')return [];if(name==='templateLock')return false;if(name==='currentBlockIndex')return index+1;const types=Array.isArray(desc.type)?desc.type:[desc.type];if(types.includes('array'))return [];if(types.includes('object'))return {};if(types.includes('boolean'))return false;if(types.includes('number'))return 0;return ''}
function normalizeBackgroundLayers(value,id='media'){const layers=Array.isArray(value)?value:(value&&typeof value==='object'?[value]:[]);return layers.filter(Boolean).map((raw,i)=>{const layer=cleanExportValue(raw),src=layer.src||layer.url||layer.media?.src||layer.media?.url||layer.desktop?.media?.src||layer.desktop?.media?.url||'';if(!src)return layer;const alt=layer.alt||layer.media?.alt||layer.desktop?.media?.alt||'Editorial image';
    // The DST background layer already carries `posterImage` and a per-breakpoint
    // media descriptor with a mime type, so a clip needs no new attribute — only
    // the honest type. A poster is required: a background that has not buffered
    // yet must not be a hole in the page.
    const video=isVideoMedia(layer);
    const descriptor=side=>(video?{...side,media:{url:src,title:alt,mime:layer.mime||'video/mp4',type:'video'}}:side);
    return {...layer,id:layer.id||`${id}-layer-${i+1}`,src,alt,source:layer.source||'skill-placeholder',intent:layer.intent||(video?'editorial-video':'editorial-photo'),
      // `posterImage` and the per-breakpoint mime are the DST layer's own way of
      // saying "this background is a clip"; no new attribute is invented.
      ...(video?{kind:'video',mime:layer.mime||'video/mp4',posterImage:layer.posterImage||layer.poster||''}:{}),
      desktop:descriptor({size:layer.desktop?.size||'cover',focal:layer.desktop?.focal||{x:.5,y:.5},...(layer.desktop||{})}),
      mobile:descriptor({size:layer.mobile?.size||layer.desktop?.size||'cover',focal:layer.mobile?.focal||{x:.56,y:.42},...(layer.mobile||{})}),
      lazy:layer.lazy!==false,hideMobile:!!layer.hideMobile}})}
function normalizeDecorationList(list=[]){return (Array.isArray(list)?list:[]).map(d=>{const out=cleanExportValue(d);if(out.motif==='topo-lines'&&out.position==='cover')out.position='right';if(out.motif==='tick-scale-h'&&Number(out.opacity)<1){out.motif='blueprint-grid';out.position='cover';out.opacity=.08}if(['top-left','top-right','bottom-left','bottom-right'].includes(out.position)&&Number(out.scale)>1)out.scale=1;return out})}
function normalizeExportNode(input,ctx={depth:0,index:0}){let node=cleanExportValue(deepClone(input||{}));node.attributes=node.attributes&&typeof node.attributes==='object'?node.attributes:{};node.layout=node.layout&&typeof node.layout==='object'?node.layout:{};const attrs=node.attributes;
  if(Object.prototype.hasOwnProperty.call(attrs,'dsContainer')){node.layout.container=exportContainer(attrs.dsContainer,node.layout.container||'default');delete attrs.dsContainer}
  if(Object.prototype.hasOwnProperty.call(attrs,'dsPadding')){node.layout.padding=exportSpacing(attrs.dsPadding,node.layout.padding||{top:'default',bottom:'default'});delete attrs.dsPadding}
  if(Object.prototype.hasOwnProperty.call(attrs,'dsMargin')){const m=exportMargin(attrs.dsMargin);if(m)node.layout.margin=m;delete attrs.dsMargin}
  if(Object.prototype.hasOwnProperty.call(attrs,'dsEffects')){node.dsEffects=normalizeExportEffects(node.dsEffects||attrs.dsEffects);delete attrs.dsEffects}else if(node.dsEffects)node.dsEffects=normalizeExportEffects(node.dsEffects)
  if(node.decorations)node.decorations=normalizeDecorationList(node.decorations)
  if(node.component==='ds-blocks/dst-banner'){attrs.backgroundImage=normalizeBackgroundLayers(attrs.backgroundImage,node.id);attrs.bannerHeight=attrs.bannerHeight||'auto';attrs.bannerTabletHeight=attrs.bannerTabletHeight||'auto';attrs.bannerMobileHeight=attrs.bannerMobileHeight||'auto';attrs.innerContainerWidth=attrs.innerContainerWidth||'container';attrs.horizontalAlign=attrs.horizontalAlign||'left';attrs.horizontalAlignMobile=attrs.horizontalAlignMobile||'center';attrs.innerVerticalAlign=attrs.innerVerticalAlign||'center';attrs.backgroundOverlayEnabled=attrs.backgroundOverlayEnabled!==false;attrs.backgroundOverlayOpacity=Number.isFinite(Number(attrs.backgroundOverlayOpacity))?Number(attrs.backgroundOverlayOpacity):1}
  if(node.component==='ds-blocks/dst-wrapper'&&attrs.backgroundImage)attrs.backgroundImage=normalizeBackgroundLayers(attrs.backgroundImage,node.id)
  if(node.component==='core/paragraph'){node.text=node.text||attrs.content||'';delete attrs.content}
  if(node.component==='ds-blocks/c-btn'){attrs.link={url:normalizeLink(attrs.link),opensInNewTab:!!attrs.link?.opensInNewTab,title:attrs.link?.title||''};if(attrs.iconPosition==='right')attrs.iconPosition='row-reverse';if(!['row','row-reverse'].includes(attrs.iconPosition))attrs.iconPosition='row-reverse'}
  if(node.component==='ds-blocks/c-heading'){attrs.backtitle=attrs.backtitle||'';attrs.titleTypography={tag:attrs.titleTypography?.tag||'h2',preset:attrs.titleTypography?.preset||'h2-style',...(attrs.titleTypography||{})};attrs.alignment=attrs.alignment||attrs.alignmentDesktop||'left';attrs.alignmentMobile=attrs.alignmentMobile||attrs.alignment}
  if(node.component==='ds-blocks/ds-columns'){attrs.gap=attrs.gap||'2rem';attrs.gapTablet=attrs.gapTablet||attrs.gap;attrs.gapMobile=attrs.gapMobile||'1.6rem';attrs.templateLock=attrs.templateLock??false;attrs.desktopColumnsPerRow=Number(attrs.desktopColumnsPerRow||attrs.count||Math.max(1,(node.children||[]).length));if(attrs.layoutVariant==='flex'&&attrs.flexItemsPerRow==null)attrs.flexItemsPerRow=attrs.desktopColumnsPerRow}
  if(node.component==='ds-blocks/ds-column'){attrs.allowedBlocks=Array.isArray(attrs.allowedBlocks)?attrs.allowedBlocks:[];attrs.templateLock=attrs.templateLock??false}
  if(node.component==='ds-blocks/c-cards'){attrs.source=attrs.source==='post-type'?'post-type':'static';attrs.sourceType=['query','manual'].includes(attrs.sourceType)?attrs.sourceType:'manual';attrs.columnsDesktop=Number(attrs.columnsDesktop||attrs.columns||Math.max(2,Math.min(4,(node.children||[]).length||3)));attrs.columnsTablet=Number(attrs.columnsTablet||Math.min(2,attrs.columnsDesktop));attrs.columnsMobile=Number(attrs.columnsMobile||1);attrs.gapVertical=attrs.gapVertical||'2.4rem';attrs.gapVerticalTablet=attrs.gapVerticalTablet||'2rem';attrs.gapVerticalMobile=attrs.gapVerticalMobile||'1.6rem';attrs.gapHorizontal=attrs.gapHorizontal||'2.4rem';attrs.gapHorizontalTablet=attrs.gapHorizontalTablet||'2rem';attrs.gapHorizontalMobile=attrs.gapHorizontalMobile||'1.6rem';attrs.cardItemPadding=attrs.cardItemPadding||zeroBox();attrs.cardItemPaddingTablet=attrs.cardItemPaddingTablet||cleanExportValue(attrs.cardItemPadding);attrs.cardItemPaddingMobile=attrs.cardItemPaddingMobile||cleanExportValue(attrs.cardItemPadding);attrs.bodyPadding=attrs.bodyPadding||zeroBox();attrs.bodyPaddingTablet=attrs.bodyPaddingTablet||cleanExportValue(attrs.bodyPadding);attrs.bodyPaddingMobile=attrs.bodyPaddingMobile||cleanExportValue(attrs.bodyPadding);if(attrs.enableBorder){attrs.cardBorder=attrs.cardBorder||{width:'1px',style:'solid',color:'var(--dst--border-color)'}}}
  if(node.component==='ds-blocks/c-card-item'){if(attrs.button==null)attrs.button={};if(attrs.link&&typeof attrs.link==='string')attrs.link={url:normalizeLink(attrs.link),opensInNewTab:false,title:''}}
  if(node.component==='ds-blocks/c-list'){attrs.colCount=Number(attrs.colCount||1);attrs.colCountTablet=Number(attrs.colCountTablet||Math.min(2,attrs.colCount));attrs.colCountMobile=Number(attrs.colCountMobile||1);if(attrs.layoutVariant!=='flex')delete attrs.flexJustify;if(attrs.listTheme==='inverted')attrs.titleTypography={...(attrs.titleTypography||{}),color:'var(--dst--base-heading-color-alt)'};if(attrs.enableTimeline){attrs.colCount=1;attrs.colCountTablet=1;attrs.colCountMobile=1;attrs.timelineType='vertical'}}
  if(node.component==='ds-blocks/c-list-item'){if(attrs.icon&&typeof attrs.icon==='object')attrs.iconDisplay='inline';if(attrs.iconDisplay==='icon')attrs.iconDisplay='inline';attrs.contentMode=attrs.contentMode||'simple'}
  if(node.component==='ds-blocks/ds-tab')attrs.currentBlockIndex=Number(attrs.currentBlockIndex||ctx.index+1)
  if(node.component==='ds-blocks/c-accordion'){attrs.dataSource=attrs.dataSource||'static';attrs.faqItems=Array.isArray(attrs.faqItems)?attrs.faqItems:[];attrs.faqIds=Array.isArray(attrs.faqIds)?attrs.faqIds:[];attrs.dsContainerSideGap=false}
  const reg=DATA.registry[node.component];if(reg&&node.component!=='gravityforms/form'&&!node.component.startsWith('core/')){const allowed=new Map((reg.attributes||[]).map(a=>[a.name,a]));for(const key of Object.keys(attrs)){if(!allowed.has(key))delete attrs[key]}const required=(reg.attributes||[]).filter(a=>!a.hasDefault);for(const desc of required){if(!Object.prototype.hasOwnProperty.call(attrs,desc.name))attrs[desc.name]=mandatoryExportValue(desc,attrs,ctx.index)}for(const [key,desc] of allowed){const val=attrs[key],values=desc.enum;if(values&&typeof val==='string'&&val!==''&&!values.includes(val)){const fallback=desc.hasDefault&&values.includes(desc.default)?desc.default:values[0];attrs[key]=fallback}}}
  if(ctx.depth>0&&['default','alt','wide'].includes(node.layout.container))node.layout.container='full';node.children=(Array.isArray(node.children)?node.children:[]).map((child,i)=>normalizeExportNode(child,{...ctx,depth:ctx.depth+1,index:i}));return node}
function makeFullBleedBand(input,section){const chosen=['default','alt'].includes(section.layout?.container)?section.layout.container:'default';let outer,content;if(input.component==='ds-blocks/dst-wrapper'){outer=input;content=outer.children||[]}else{const carriedEffects=input.dsEffects?deepClone(input.dsEffects):null,carriedDecorations=input.decorations?deepClone(input.decorations):null;const innerContent=input;for(const key of ['pattern','patternMeta','role','composed','note','inverted','dsEffects','decorations'])delete innerContent[key];innerContent.layout={...(innerContent.layout||{}),container:'full'};outer={id:input.id,component:'ds-blocks/dst-wrapper',usage:FAMILY_USAGE[section.family]||'section',confidence:'confirmed',attributes:{},layout:{},children:[]};if(carriedEffects)outer.dsEffects=carriedEffects;if(carriedDecorations)outer.decorations=carriedDecorations;content=[innerContent]}
  outer.attributes=outer.attributes||{};outer.attributes.fullWidthWrapper=true;
  // The inverted ground is the colour *behind* the picture, not instead of it.
  // Deleting the photograph here was the second half of the same defect: an
  // inverted photo band exported as a flat dark rectangle.
  const invertedBg=(outer.attributes.backgroundImage||[]).length;
  if(!outer.attributes.backgroundColor||!invertedBg)outer.attributes.backgroundColor='var(--dst--body-bg-alt)';
  outer.layout={...(outer.layout||{}),container:'full',fullWidthWrapper:true,padding:{top:section.layout?.paddingTop||'default',bottom:section.layout?.paddingBottom||'default'},background:invertedBg?{kind:'media'}:{kind:'slot',slot:'body-bg-alt'}};outer.inverted=true;outer.children=[{id:`${outer.id}-inner`,component:'ds-blocks/dst-wrapper',usage:'inner-container',confidence:'confirmed',attributes:{htmlTag:'div'},layout:{container:chosen,padding:{top:'none',bottom:'none'}},children:content}];return outer}
function normalizeExportSection(section){syncSectionNode(section);let node=normalizeExportNode(section.node,{depth:0,index:0,section});node.pattern=section.patternId;node.role=section.family;node.usage=FAMILY_USAGE[section.family]||node.usage||'section';node.inverted=!!section.layout?.inverted;node.note=`Built from ${section.patternId} (${patternLabel(section)}); edited in the SBS DST Page Builder.`;node.composed={patternId:section.patternId,family:section.family,source:'attached-skill-library'};node.layout={...(node.layout||{}),container:section.layout?.container||node.layout?.container||'default',padding:{top:section.layout?.paddingTop||'default',bottom:section.layout?.paddingBottom||'default'}};
  if(node.component==='ds-blocks/dst-banner'){node.layout.container='full';node.layout.background=(node.attributes?.backgroundImage||[]).length?{kind:'media'}:{kind:'slot',slot:section.layout?.inverted?'body-bg-alt':'body-bg'};node.layout.banner={height:node.attributes.bannerHeight||'auto',borderRadius:node.attributes.borderRadius||'none',scrollDown:!!node.attributes.showScrollDown,scrollDownPosition:node.attributes.scrollDownPosition||'sd-left',considerHeader:!!node.attributes.considerHeaderHeight};node.attributes.backgroundColor=`var(--dst--${section.layout?.inverted?'body-bg-alt':'body-bg'})`;node.attributes.innerContainerWidth=node.attributes.innerContainerWidth||'container'}
  else if(section.layout?.inverted){node=makeFullBleedBand(node,section)}
  else if(node.component==='ds-blocks/dst-wrapper'){
    /*
     * A band keeps its own background.
     *
     * This used to delete `backgroundImage` and `backgroundColor` outright, which
     * meant a pattern authored as a photograph with a scrim over it arrived in
     * WordPress as a flat colour — and, worse, arrived different from the preview
     * that had just been approved, because the preview renders both. Two thirds
     * of the library is rooted in a wrapper, so this was most of the page.
     *
     * `fullWidthWrapper` is still dropped: that is the builder's own bookkeeping
     * for an inverted full-bleed band, not a DST attribute.
     */
    var wrapperBg=(node.attributes.backgroundImage||[]).length?{kind:'media'}:null;
    if(wrapperBg)node.layout.background=wrapperBg;
    else if(node.layout?.background&&node.layout.background.kind!=='none')delete node.layout.background;
    delete node.layout.fullWidthWrapper;delete node.attributes.fullWidthWrapper}
  const directFx=/^(fade($|-)|zoom-|slide-)/.test(String(node.dsEffects?.type||''))&&!String(node.dsEffects?.type||'').startsWith('fade-in-seq');if((node.decorations||[]).length&&directFx&&node.children?.length){node.children[0].dsEffects=deepClone(node.dsEffects);delete node.dsEffects}
  node.pattern=section.patternId;node.role=section.family;node.usage=FAMILY_USAGE[section.family]||node.usage||'section';node.inverted=!!section.layout?.inverted;node.note=`Built from ${section.patternId} (${patternLabel(section)}); edited in the SBS DST Page Builder.`;node.composed={patternId:section.patternId,family:section.family,source:'attached-skill-library'};return node}
/*
 * A colour's channels, whatever notation it arrived in.
 *
 * `#RRGGBBAA` used to fall through to the white fallback, and white is the worst
 * possible wrong answer: every tone decision downstream reads it as a light
 * ground and puts dark type on it. `sbs-hero-p1-v1` scrims its photograph with
 * `#333333b0` — very dark at 69% — and got dark copy on a dark band because of
 * this one line. The export's own overlay fold produces eight-digit hex too, so
 * the notation is now more common than when this was written.
 *
 * The alpha is dropped rather than composited: luminance here answers "is this
 * colour light or dark", and how much of it is painted is a separate question the
 * callers already ask with `v2ColorAlpha`.
 */
function hexRgb(hex){
  let h=String(hex||'').trim().replace('#','');
  if(h.length===4)h=h.slice(0,3);
  if(h.length===8)h=h.slice(0,6);
  if(h.length===3)h=h.split('').map(x=>x+x).join('');
  if(!/^[0-9a-f]{6}$/i.test(h))return [255,255,255];
  return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16));
}
function relativeLum(hex){return hexRgb(hex).map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0)}
function headerExport(project){const h=project.header;return {id:'site-header',component:'ds-blocks/dst-navigation',usage:'header',role:'header',confidence:'confirmed',importerShorthand:true,note:'Concept-level DST navigation shorthand for the importer to expand into the production navigation block family.',layout:{container:'default',background:{kind:'slot',slot:'body-bg'}},attributes:{displayType:h.position||'sticky',dsContainerAlign:'center'},linkTypography:{ref:'theme.elements.navigation.mainLink'},nav:{logo:{text:h.logoText||project.brief.clientName},menu:(h.nav||[]).map(([label,url])=>({label,url:normalizeLink(url)})),cta:{label:h.cta?.text||'Contact',url:normalizeLink(h.cta?.link||'#contact'),btnType:'primary'}},children:[]}}
function footerExport(project){const f=project.footer;return {id:'site-footer',component:'ds-blocks/dst-wrapper',usage:'footer',role:'footer',confidence:'confirmed',inverted:true,importerShorthand:true,note:'Three-band DST footer shorthand. The importer expands this into the project template part.',layout:{padding:{top:'default',bottom:'default'},container:'full',background:{kind:'slot',slot:'body-bg-alt'},fullWidthWrapper:true},attributes:{fullWidthWrapper:true,backgroundColor:'var(--dst--body-bg-alt)'},footer:{variant:'footer-v1',top:{heading:f.statement,subheading:f.description},columns:[{kind:'brand',logo:true,socialsTitle:'Connect',body:project.brief.offer},...(f.columns||[]).map(c=>({kind:'menu',heading:c.title,menuLocation:c.menuLocation||'footer-menu',links:(c.links||[]).map(([label,url])=>({label,url:normalizeLink(url)}))}))],columnWidths:['1.6fr','1fr','1fr'],columnsTablet:2,columnsMobile:1,bottom:{copyright:f.legal,privacyMenu:{menuLocation:'privacy-menu',links:[{label:'Privacy Policy',url:'#privacy'},{label:'Accessibility',url:'#accessibility'}]}},headingTypography:{tag:'div',preset:'h4-style',fontFamily:'var(--dst--font-primary)',textTransform:'uppercase',letterSpacing:'.08em',fontSize:'1.4rem',fontWeight:700},iconColor:'var(--dst--primary-color2)',legalColor:'var(--dst--base-text-color-alt)',dividerColor:'rgba(255,255,255,.18)'},children:[{id:'footer-socials',component:'ds-blocks/dst-social-networks',usage:'socials',confidence:'confirmed',attributes:{socialSource:'custom',layoutDirection:'horizontal',alignDesktop:'flex-start',socialNetworks:[{id:'linkedin',network:'linkedin',label:'LinkedIn',url:'#'},{id:'email',network:'email',label:'Email',url:'#contact'}],showCaptions:false,socialIconGap:'1.2rem'}}],decorations:[{kind:'motif',motif:'tick-scale',color:'secondary-color1',position:'right',opacity:.1,scale:.9,rationale:'A measured edge rail reinforces the continuity and readiness brief without becoming a generic texture.'}]}}
function buildTheme(project){const d=project.design,p=d.palette,darkGround=relativeLum(p.bg)<.42,inverseTitle=darkGround?(relativeLum(p.dark)<.3?p.dark:'#080A0E'):'#FFFFFF',altGround=darkGround?'#F7F7F3':p.dark;return {theme:`builder-${d.archetype.toLowerCase()}`,colors:{'primary-color1':p.ink,'primary-color2':p.accent,'primary-color3':p.dark,'secondary-color1':inverseTitle,'secondary-color2':p.bg,'secondary-color3':p.soft,'secondary-color4':p.accent,'secondary-color5':p.soft,'secondary-color6':p.accent,'secondary-color7':darkGround?altGround:'#FFFFFF','secondary-color8':p.accent,'body-bg':'secondary-color2','body-bg-alt':darkGround?'secondary-color7':'primary-color3','base-text-color':'primary-color1','base-text-color-alt':'secondary-color1','base-heading-color':'primary-color1','base-heading-color-alt':'secondary-color1','base-link-color':'primary-color2','base-link-color-alt':'secondary-color1','border-color':'secondary-color5','border-color-alt':'rgba(255,255,255,0.28)','pretitle-color':'primary-color2','pretitle-color-alt':'secondary-color1','subtitle-color':'primary-color1','subtitle-color-alt':'secondary-color1','backtitle-color-alt':'rgba(255,255,255,0.08)','counter-color':'primary-color2','counter-color-alt':'secondary-color1'},layout:{'default-radius':d.radius,'default-radius-mobile':d.radius,'default-container-width':'1440px','alt-container-width':'1060px','desktop-vertical-gap':`${(6.8+(d.density/100)*4.2).toFixed(2)}vmin`,'mobile-vertical-gap':'48px','desktop-gutter':'2.4rem','header-height':'84px','header-height-mobile':'70px'},backgrounds:{'grad-1':`linear-gradient(135deg, ${altGround}, ${p.ink})`,'grad-2':`linear-gradient(135deg, ${p.accent}, ${altGround})`},typography:{fonts:{primary:{family:d.fontBody,google:true,fallback:'system-ui, sans-serif'},secondary:{family:d.fontDisplay,google:true,fallback:'Georgia, serif'}},headings:{h1:{min:'42px',max:'10.2rem',ff:'secondary',fw:600,lh:'0.98',ls:'-0.035em',tt:'none',mb:'0.35em'},h2:{min:'32px',max:'7rem',ff:'secondary',fw:600,lh:'1.02',ls:'-0.03em',tt:'none',mb:'0.4em'},h3:{min:'22px',max:'3.6rem',ff:'secondary',fw:600,lh:'1.12',tt:'none',mb:'0.5em'},h4:{min:'18px',max:'2.4rem',ff:'primary',fw:600,lh:'1.25',tt:'none',mb:'0.5em'},pretitle:{min:'11px',max:'1.4rem',ff:'primary',fw:600,lh:'1.2',ls:'0.18em',tt:'uppercase',mb:'0.9em',color:'pretitle-color'},subtitle:{min:'18px',max:'2.2rem',ff:'primary',fw:400,lh:'1.55',tt:'none',color:'base-text-color'},backtitle:{min:'60px',max:'14rem',ff:'secondary',fw:600,tt:'none',color:'secondary-color2'}},body:{base:{ff:'primary',fw:400,lh:'1.65',ls:'0'},scale:{sm:{min:'14px',max:'1.5rem'},base:{min:'16px',max:'1.8rem'},lg:{min:'19px',max:'2.3rem'}},presets:[]}},elements:{navigation:{mainLink:{ff:'primary',fs:'1.6rem',fw:600,tt:'none',ls:'0',color:'primary-color1',colorHover:'primary-color2'},mobileLink:{ff:'primary',fs:'2rem',fw:600,color:'primary-color1'}},buttons:{shared:{ff:'primary',fs:'1.5rem',fw:650,tt:'none',ls:'0',radius:d.radius,padding:'1.55rem 2.7rem',gap:'.9em',iconSize:'1.4rem'},sizes:{small:{fs:'1.4rem',padding:'1.1rem 2rem'},large:{fs:'1.8rem',padding:'1.8rem 3.4rem'}},primary:{c:'secondary-color1',bg:'primary-color1',bdc:'primary-color1',bdw:'0',cHover:'secondary-color1',bgHover:'primary-color3',bdcHover:'primary-color3'},primaryInverted:{c:'primary-color1',bg:'secondary-color1',bdc:'secondary-color1',bdw:'0',cHover:'secondary-color1',bgHover:'primary-color2',bdcHover:'primary-color2'},secondary:{c:'primary-color1',bg:'transparent',bdc:'primary-color1',bdw:'1px',cHover:'secondary-color1',bgHover:'primary-color1',bdcHover:'primary-color1'},secondaryInverted:{c:'secondary-color1',bg:'transparent',bdc:'secondary-color1',bdw:'1px',cHover:'primary-color1',bgHover:'secondary-color1',bdcHover:'secondary-color1'},link:{c:'primary-color1',cHover:'primary-color2',iconColor:'primary-color1'},icon:{enabled:true,linkEnabled:true,icon:'lib-icon-arrow2',position:'row-reverse'}},forms:{label:{fs:'1.4rem',fw:600,tt:'none',color:'primary-color1'},input:{borderWidth:'1px',borderRadius:d.radius,paddingBlock:'1.2rem',paddingInline:'1.6rem',fs:'1.6rem',fw:400,height:'',color:'primary-color1',placeholderColor:'primary-color1',borderColor:'secondary-color5'},message:{fs:'1.4rem',lh:'1.5',fw:400},validation:{error:'#B94135',success:'#26775A',notice:'primary-color1'}},testimonials:{quote:{ff:'secondary',fs:'4rem',lh:'1.18',fw:600,tt:'none',color:'primary-color1'},authorName:{ff:'primary',fs:'1.6rem',fw:700,color:'primary-color1'},authorPosition:{ff:'primary',fs:'1.4rem',fw:400,color:'primary-color1'},avatarSize:'5.4rem',avatarRadius:'999px',quoteIcon:inlineQuoteIcon('Quotation mark'),quoteIconSize:'5rem'},socials:{size:'4rem',gap:'1rem',radius:d.radius,inner:'1.8rem',borderWidth:'1px',borderColor:'secondary-color1',bg:'transparent',color:'secondary-color1',bgHover:'primary-color2',colorHover:'secondary-color1',borderHoverColor:'primary-color2'},sliders:{nav:{size:'5rem',iconSize:'1.6rem',radius:'999px',gap:'1rem',borderWidth:'1px',bg:'transparent',iconColor:'primary-color1',borderColor:'secondary-color5',bgHover:'primary-color1',iconHoverColor:'secondary-color1',borderHoverColor:'primary-color1'},pagination:{progressbarSize:'.4rem',progressbarFillSize:'',color:'primary-color1',progressbarBg:'secondary-color5',currentFs:'1.6rem',currentFw:700,totalFs:'1.6rem',totalFw:400,bulletSize:'1rem',bulletGap:'.6rem',bulletRadius:'999px',bulletInactiveColor:'secondary-color5'}},wysiwyg:{listIconWidth:'2rem',listIconPosition:'.4rem'}},motion:{customEffects:{}}}}
function buildExport(project){project.sections.forEach(syncSectionNode);const arch=DATA.archetypes[project.design.archetype]||{},p=project.design.palette;const sections=[headerExport(project),...project.sections.filter(s=>s.visible!==false).map(normalizeExportSection),footerExport(project)];return {$schemaComment:'DST concept export generated by the SBS Page Builder using the attached dst-concept-to-json-patterns skill.',$provenanceNote:'All module trees preserve registered DST components and original SBS pattern provenance. Real media references include source and alt metadata.',schemaVersion:'dst-concept-export/1.0',catalogVersion:DATA.skill.catalogVersion||'4.0-three-source (merged)',generatedFrom:'dst-concept-to-json',client:{name:project.brief.clientName||project.client,slug:slugify(project.brief.clientName||project.client),sourceUrl:'',primaryObjective:project.brief.goal,primaryKeyword:(project.brief.keywords||'').split(',')[0]?.trim()||'',brandPaletteCaptured:[{role:'body canvas',hex:p.bg},{role:'ink and headings',hex:p.ink},{role:'brand accent',hex:p.accent},{role:'supporting surface',hex:p.soft},{role:'inverted ground',hex:p.dark}]},concept:{id:slugify(project.id),name:`${project.brief.projectName} — ${DATA.archetypes[project.design.archetype]?.name||'Custom concept'}`,archetype:`${project.design.archetype} — ${DATA.archetypes[project.design.archetype]?.name||'Custom'}`,polarity:arch.polarity||'light',isActivePreview:true,theme:buildTheme(project),page:{title:project.brief.projectName,slug:slugify(project.brief.projectName),flow:{id:project.flowId,name:flowById(project.flowId,project)?.name||'Custom',rationale:flowById(project.flowId,project)?.tagline||'Custom sequence'},sections}},__status:{builder:'SBS DST Page Builder',skill:DATA.skill.name,patternsAvailable:DATA.skill.patternCount,generatedAt:new Date().toISOString(),validation:validateProject()}}}
async function handleExport(type){const slug=slugify(state.project.brief.projectName);if(type==='json'){downloadFile(`${slug}-dst-concept.json`,JSON.stringify(buildExport(state.project),null,2),'application/json');announce('WordPress importer JSON downloaded')}else if(type==='html'){downloadFile(`${slug}-website.html`,buildSiteDocument(state.project),'text/html');announce('Standalone website HTML downloaded')}else if(type==='copy'){const text=JSON.stringify(buildExport(state.project),null,2);try{await navigator.clipboard.writeText(text);announce('Project JSON copied')}catch(e){const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();announce('Project JSON copied')}}}

state.project.sections.forEach(s=>{ensureSectionSettings(s);syncSectionNode(s)});
renderAll();
setTimeout(updateDevice,100);

(function(){
'use strict';

var SBS_BUILDER_VERSION='2.9.0';
var legacySiteCssV1=siteCss;
var legacyApplyArchetypeV1=applyArchetype;
var legacyValidateProjectV1=validateProject;
var legacyUpdateBindingV1=updateBinding;

function v2Initials(value){
  var parts=String(value||'SBS').trim().split(/\s+/).filter(Boolean);
  if(!parts.length)return 'SBS';
  return (parts.length===1?parts[0].slice(0,2):parts[0][0]+parts[parts.length-1][0]).toUpperCase();
}
function v2Bool(value){return value===true||value==='true'||value===1||value==='1'}

/* ---------------------------------------------------------------- *
 * Mobile menu styles
 *
 * All four are the same takeover — full screen, one tap to open, the brand and
 * the close control pinned where the header already was. What differs is the
 * composition of the links inside it, which is the part a client reacts to.
 *
 * They are one enumeration used in three places: the editor select, the CSS that
 * paints the preview and the exported site, and the navigation JSON the importer
 * reads. Adding a fifth means adding it here and nowhere else.
 * ---------------------------------------------------------------- */
var MOBILE_MENU_STYLES=[
  {value:'center',short:'Centred',label:'Full screen · centred',note:'The original. Links stacked and centred on the canvas colour.'},
  {value:'left',short:'Left',label:'Full screen · left aligned',note:'Links flush left with running numbers, like a contents page.'},
  {value:'right',short:'Right',label:'Full screen · right aligned',note:'Links flush right against the edge, weighted like a masthead.'},
  {value:'aurora',short:'Aurora',label:'Full screen · aurora (expressive)',note:'A tinted gradient field, oversized type, a circular reveal from the toggle and links that fill on touch.'}
];
var HEADER_VARIANTS=[
  {value:'standard',label:'Standard · logo left',note:'Logo left, links and the action right. The default for a reason.'},
  {value:'centered',label:'Centred logo',note:'Logo in the middle, links left, the action right.'},
  {value:'stacked',label:'Stacked · logo over links',note:'Logo centred on its own line with the menu centred beneath it. Reads as a masthead.'},
  {value:'floating',label:'Floating bar',note:'The bar is inset from the page edges and reads as a rounded panel rather than a full-width band.'},
  {value:'minimal',label:'Minimal · burger only',note:'A compact bar with no desktop links: everything is behind the menu button.'}
];
var HEADER_VARIANT_DEFAULT='standard';
function headerVariant(value){
  var raw=cleanText(value);
  return HEADER_VARIANTS.some(function(entry){return entry.value===raw})?raw:HEADER_VARIANT_DEFAULT;
}
var FOOTER_VARIANTS=[
  {value:'editorial',label:'Editorial statement',note:'A full-width closing statement above the menu columns.'},
  {value:'compact',label:'Compact utility',note:'Statement and action on one line, so the columns start higher.'},
  {value:'centered',label:'Centred closing',note:'Statement, columns and the legal line all centred.'},
  {value:'columns',label:'Statement beside the menus',note:'The statement moves to the left and the menu columns sit next to it.'},
  {value:'minimal',label:'Minimal sign-off',note:'One line of brand, the menus and the legal row. No large statement, no wordmark.'}
];
var FOOTER_VARIANT_DEFAULT='editorial';
function footerVariant(value){
  var raw=cleanText(value);
  return FOOTER_VARIANTS.some(function(entry){return entry.value===raw})?raw:FOOTER_VARIANT_DEFAULT;
}
var MOBILE_MENU_DEFAULT='center';
function mobileMenuStyle(value){
  var raw=cleanText(value);
  return MOBILE_MENU_STYLES.some(function(style){return style.value===raw})?raw:MOBILE_MENU_DEFAULT;
}
/**
 * Fills missing defaults into an existing object without replacing it.
 *
 * Replacing `project.header` would write through to the active concept and stamp
 * a revision, so a render would look like an edit. It also churns object identity
 * on every pass, which is what detached a pending write in the brain slice.
 */
function v5FillDefaults(target,defaults){
  Object.keys(defaults).forEach(function(key){
    if(target[key]===undefined)target[key]=defaults[key];
  });
  return target;
}
/** The concept-owned slice objects, created only when genuinely absent. */
function v5EnsureSlice(project,key,factory){
  var value=project[key];
  if(!value||typeof value!=='object'){value=factory();project[key]=value}
  return value;
}
function v2EnsureProject(project){
  project.brief=project.brief||{};
  if(project.brief.clientNameCustom==null)project.brief.clientNameCustom=false;
  v5EnsureSlice(project,'design',function(){return {}});
  project.design.density=Number.isFinite(Number(project.design.density))?Number(project.design.density):50;
  project.design.expressiveness=Number.isFinite(Number(project.design.expressiveness))?Number(project.design.expressiveness):50;
  project.design.motion=Number.isFinite(Number(project.design.motion))?Number(project.design.motion):35;
  var brand=cleanText(project.brief.clientName||project.brief.projectName||project.client||'Untitled brand');
  v5FillDefaults(v5EnsureSlice(project,'header',function(){return {}}),{
    variant:'standard',position:'sticky',frostedGlass:true,hideOnScrollDown:false,container:'default',
    // How the burger's full-screen takeover is composed. The header layout above
    // is a desktop decision and says nothing about the phone, which is where
    // most of these pages are actually read.
    mobileMenu:MOBILE_MENU_DEFAULT,
    announcement:'',announcementDismissible:false,logoText:brand,logoMark:v2Initials(brand),logoUrl:'',
    logoTextCustom:false,logoMarkCustom:false,logoAlt:'',logoDescription:'',
    // Empty means "follow the palette". A colour is only written here when
    // somebody deliberately overrode it, so re-picking an archetype still
    // restyles the whole page rather than leaving the chrome stranded.
    bgColor:'',bgOpacity:90,textColor:'',linkHoverColor:'',borderColor:'',
    nav:[['Who we are','#about'],['Capabilities','#capabilities'],['Approach','#process'],['Resources','#resources']],
    cta:{text:'Request a briefing',link:'#contact'}
  });
  if(!Array.isArray(project.header.nav))project.header.nav=[];
  project.header.nav=project.header.nav.map(function(item){
    if(Array.isArray(item))return [String(item[0]||''),String(item[1]||'#')];
    return [String(item&&item.label||''),String(item&&item.url||'#')];
  });
  project.header.cta={text:'Contact',link:'#contact',...(project.header.cta||{})};
  project.header.mobileMenu=mobileMenuStyle(project.header.mobileMenu);
  project.header.variant=headerVariant(project.header.variant);
  // The slider writes a string; the CSS needs a number it can trust.
  var headerOpacity=Number(project.header.bgOpacity);
  project.header.bgOpacity=Number.isFinite(headerOpacity)?clamp(headerOpacity,0,100):90;
  v5FillDefaults(v5EnsureSlice(project,'footer',function(){return {}}),{
    variant:'editorial',logoText:brand,logoMark:v2Initials(brand),logoUrl:'',logoTextCustom:false,logoMarkCustom:false,
    logoAlt:'',logoDescription:'',
    bgColor:'',textColor:'',headingColor:'',linkColor:'',accentColor:'',
    statement:'Build the next page with a system the team can reuse.',
    description:'A complete DST page, global navigation and footer, ready for importer handoff.',
    cta:{text:'Start a conversation',link:'#contact'},
    columns:[
      {title:'Explore',menuLocation:'footer-menu',links:[['Capabilities','#capabilities'],['Approach','#process'],['Resources','#resources']]},
      {title:'Company',menuLocation:'company-menu',links:[['Who we are','#about'],['Contact','#contact'],['Privacy','#privacy']]}
    ],
    socials:[{network:'linkedin',label:'LinkedIn',url:'#'},{network:'email',label:'Email',url:'#contact'}],
    privacyLinks:[['Privacy','#privacy'],['Accessibility','#accessibility']],
    legal:brand+' · Demonstration concept',legalCustom:false,wordmark:brand.split(' ')[0]||brand
  });
  project.footer.variant=footerVariant(project.footer.variant);
  project.footer.cta={text:'Start a conversation',link:'#contact',...(project.footer.cta||{})};
  if(!Array.isArray(project.footer.columns))project.footer.columns=[];
  project.footer.columns=project.footer.columns.map(function(col,i){
    var out={title:'Column '+(i+1),menuLocation:'footer-menu',links:[],...(col||{})};
    if(!Array.isArray(out.links))out.links=[];
    out.links=out.links.map(function(item){return Array.isArray(item)?[String(item[0]||''),String(item[1]||'#')]:[String(item&&item.label||''),String(item&&item.url||'#')]});
    return out;
  });
  if(!Array.isArray(project.footer.socials))project.footer.socials=[];
  if(!Array.isArray(project.footer.privacyLinks))project.footer.privacyLinks=[];
  project.footer.privacyLinks=project.footer.privacyLinks.map(function(item){return Array.isArray(item)?item:[item.label,item.url]});
  v2SyncBrand(project,false);
  (project.sections||[]).forEach(function(s){
    ensureSectionSettings(s);
    s.layout.heroMediaMode=s.layout.heroMediaMode||'full';
    s.layout.headingAlign=s.layout.headingAlign||'';
    s.layout.headingAlignMobile=s.layout.headingAlignMobile||'';
  });
  return project;
}
function v2SyncBrand(project,force){
  var brand=cleanText(project.brief.clientName||project.brief.projectName||project.client||'Untitled brand');
  if(force||!project.header.logoTextCustom)project.header.logoText=brand;
  if(force||!project.header.logoMarkCustom)project.header.logoMark=v2Initials(brand);
  if(force||!project.footer.logoTextCustom)project.footer.logoText=brand;
  if(force||!project.footer.logoMarkCustom)project.footer.logoMark=v2Initials(brand);
  if(force||!project.footer.legalCustom)project.footer.legal=brand+' · Demonstration concept';
  if(!project.footer.wordmark)project.footer.wordmark=brand.split(' ')[0]||brand;
}
function v2NavRows(header){
  return '<div class="global-list">'+header.nav.map(function(item,i){return '<div class="global-row"><input data-nav-item="'+i+'" data-key="label" value="'+escAttr(item[0])+'" placeholder="Navigation label"><input data-nav-item="'+i+'" data-key="url" value="'+escAttr(item[1])+'" placeholder="#anchor or URL"><button class="mini-btn danger" data-global-action="remove-nav" data-index="'+i+'" title="Remove">'+ICONS.trash+'</button></div>'}).join('')+'<button class="add-row" data-global-action="add-nav">+ Add navigation item</button></div>';
}
function v2FooterColumns(footer){
  return '<div class="global-columns">'+footer.columns.map(function(col,ci){return '<div class="global-subpanel"><div class="global-subpanel-head"><b>Footer column '+(ci+1)+'</b><button class="text-btn" data-global-action="remove-footer-column" data-column="'+ci+'">Remove</button></div><div class="field-grid">'+field('Column heading','global.footer.columns.'+ci+'.title',col.title,{full:true})+'</div><div class="global-list">'+col.links.map(function(item,li){return '<div class="global-row"><input data-footer-column="'+ci+'" data-footer-link="'+li+'" data-key="label" value="'+escAttr(item[0])+'" placeholder="Link label"><input data-footer-column="'+ci+'" data-footer-link="'+li+'" data-key="url" value="'+escAttr(item[1])+'" placeholder="#anchor or URL"><button class="mini-btn danger" data-global-action="remove-footer-link" data-column="'+ci+'" data-link="'+li+'" title="Remove">'+ICONS.trash+'</button></div>'}).join('')+'<button class="add-row" data-global-action="add-footer-link" data-column="'+ci+'">+ Add footer link</button></div></div>'}).join('')+'<button class="add-row" data-global-action="add-footer-column">+ Add footer column</button></div>';
}
/**
 * One colour override.
 *
 * An unset colour has to stay visibly unset. An `input[type=color]` cannot hold
 * "empty" — it shows black — so the swatch is seeded with the palette colour it
 * is currently inheriting, and the row says which of the two states it is in
 * with a one-click way back. Without that, opening the panel and closing it
 * again would silently pin five colours the strategist never chose.
 */
function v7ColorField(label,path,value,fallback,help){
  var custom=!!cleanText(value);
  return '<div class="field color-override'+(custom?' is-custom':'')+'">'+
    '<label>'+esc(label)+'</label>'+
    '<div class="color-override__row">'+
      '<input type="color" data-bind="'+escAttr(path)+'" value="'+escAttr(custom?value:(fallback||'#ffffff'))+'">'+
      '<span class="color-override__state">'+(custom?esc(String(value).toUpperCase()):'Following the palette')+'</span>'+
      (custom?'<button type="button" class="text-btn" data-global-action="clear-color" data-path="'+escAttr(path)+'">Reset</button>':'')+
    '</div>'+
    (help?'<div class="field-help">'+esc(help)+'</div>':'')+
  '</div>';
}

function v7RangeField(label,path,value,help){
  var number=Number.isFinite(Number(value))?Math.round(Number(value)):90;
  return '<div class="field full range-field"><label>'+esc(label)+' <output>'+number+'%</output></label>'+
    '<input type="range" min="0" max="100" step="1" data-bind="'+escAttr(path)+'" value="'+number+'">'+
    (help?'<div class="field-help">'+esc(help)+'</div>':'')+'</div>';
}

/** The note for whichever entry of a variant catalogue is currently chosen. */
function v2VariantHelp(catalog,value){
  var match=catalog.filter(function(entry){return entry.value===cleanText(value)})[0]||catalog[0];
  return match?match.note:'';
}

/** What the chosen mobile menu actually does, under the select that chose it. */
function v2MobileMenuHelp(value){
  var chosen=mobileMenuStyle(value),style=MOBILE_MENU_STYLES.filter(function(entry){return entry.value===chosen})[0];
  return (style?style.note+' ':'')+'Switch the preview to Mobile to see it — the burger only exists below 900px.';
}

function v2GlobalEditors(){
  v2EnsureProject(state.project);
  var h=state.project.header,f=state.project.footer,p=state.project.design.palette;
  var headerPanel=panel('Global navigation','<div class="panel-note">This is a global DST navigation pattern. Its logo, menu and CTA are independent from the page modules and export as their own JSON.</div><div class="field-grid">'+
    field('Logo / site title','global.header.logoText',h.logoText,{help:'Automatically follows Client / brand until you edit it here.'})+
    field('Logo mark','global.header.logoMark',h.logoMark,{help:'Short initials or mark shown in the preview.'})+
    field('Logo image URL','global.header.logoUrl',h.logoUrl||'',{full:true,help:'Optional. When supplied, the image is the whole identity — the initials mark and the wordmark beside it are dropped, because the file already carries the name.'})+
    field('Logo alt text','global.header.logoAlt',h.logoAlt||'',{help:'What a screen reader reads instead of the image. Defaults to the logo / site title.'})+
    field('Logo description','global.header.logoDescription',h.logoDescription||'',{help:'Optional longer description, shown as the tooltip.'})+
    field('Header layout','global.header.variant',headerVariant(h.variant),{type:'select',full:true,options:HEADER_VARIANTS.map(function(entry){return {value:entry.value,label:entry.label}}),help:v2VariantHelp(HEADER_VARIANTS,h.variant)+' Hover the navigation in the preview to step through the five with the arrows.'})+
    field('Mobile menu style','global.header.mobileMenu',mobileMenuStyle(h.mobileMenu),{type:'select',full:true,options:MOBILE_MENU_STYLES.map(function(style){return {value:style.value,label:style.label}}),help:v2MobileMenuHelp(h.mobileMenu)})+
    field('Header behavior','global.header.position',h.position,{type:'select',options:[{value:'static',label:'Static'},{value:'sticky',label:'Sticky'},{value:'fixed',label:'Fixed'}]})+
    field('Frosted glass','global.header.frostedGlass',String(!!h.frostedGlass),{type:'select',options:[{value:'false',label:'Off'},{value:'true',label:'On'}]})+
    field('Hide while scrolling down','global.header.hideOnScrollDown',String(!!h.hideOnScrollDown),{type:'select',options:[{value:'false',label:'No'},{value:'true',label:'Yes'}]})+
    field('Announcement bar','global.header.announcement',h.announcement||'',{full:true,help:'Leave empty to disable it.'})+
    field('Header CTA label','global.header.cta.text',h.cta.text)+field('Header CTA link','global.header.cta.link',h.cta.link)+
    '</div><div class="global-section-title"><b>Navigation colours</b><small>Empty follows the palette</small></div>'+
    '<div class="field-grid">'+
    v7RangeField('Background opacity','global.header.bgOpacity',h.bgOpacity,'How much of the canvas colour the bar carries. Lower lets the hero read through it; the stuck state stays a little more solid so text over content is always legible.')+
    v7ColorField('Background','global.header.bgColor',h.bgColor,p.bg)+
    v7ColorField('Text and links','global.header.textColor',h.textColor,p.ink)+
    v7ColorField('Link hover','global.header.linkHoverColor',h.linkHoverColor,p.accent)+
    v7ColorField('Bottom border','global.header.borderColor',h.borderColor,p.soft)+
    '</div>'+
    '<div class="global-section-title"><b>Navigation items</b><button class="text-btn" data-global-action="reset-brand">Use client name for logo</button></div>'+v2NavRows(h),'Global part','data-global-part="header"');
  var footerPanel=panel('Global footer','<div class="panel-note">The footer is also a global template part. It has its own content model and exports separately from the page.</div><div class="field-grid">'+
    field('Footer layout','global.footer.variant',footerVariant(f.variant),{type:'select',full:true,options:FOOTER_VARIANTS.map(function(entry){return {value:entry.value,label:entry.label}}),help:v2VariantHelp(FOOTER_VARIANTS,f.variant)+' Hover the footer in the preview to step through the five with the arrows.'})+
    field('Footer brand','global.footer.logoText',f.logoText)+
    field('Footer mark','global.footer.logoMark',f.logoMark)+
    field('Footer logo image URL','global.footer.logoUrl',f.logoUrl||'',{full:true,help:'When supplied, the image replaces the mark and the brand text beside it.'})+
    field('Footer logo alt text','global.footer.logoAlt',f.logoAlt||'')+
    field('Footer logo description','global.footer.logoDescription',f.logoDescription||'')+
    field('Closing statement','global.footer.statement',f.statement,{type:'textarea',rows:2,full:true})+
    field('Supporting copy','global.footer.description',f.description,{type:'textarea',rows:3,full:true})+
    field('Footer CTA label','global.footer.cta.text',f.cta.text)+field('Footer CTA link','global.footer.cta.link',f.cta.link)+
    field('Legal line','global.footer.legal',f.legal,{full:true})+
    field('Large footer wordmark','global.footer.wordmark',f.wordmark||'',{full:true})+
    '</div><div class="global-section-title"><b>Footer colours</b><small>Empty follows the palette</small></div>'+
    '<div class="field-grid">'+
    v7ColorField('Background','global.footer.bgColor',f.bgColor,p.dark)+
    v7ColorField('Body text','global.footer.textColor',f.textColor,'#ffffff')+
    v7ColorField('Headings','global.footer.headingColor',f.headingColor,'#ffffff')+
    v7ColorField('Menu links','global.footer.linkColor',f.linkColor,'#ffffff')+
    v7ColorField('Icons and wordmark','global.footer.accentColor',f.accentColor,p.accent)+
    '</div>'+
    '<div class="global-section-title"><b>Footer menu columns</b></div>'+v2FooterColumns(f),'Global part');
  return headerPanel+footerPanel;
}

renderBrief=function(){
  v2EnsureProject(state.project);
  var b=state.project.brief;
  return pageHead('01 · Brief + globals','Define the page and its global parts.','The client brief drives the page. Navigation and footer remain independent global patterns so they can be imported once and reused across the site.','Autosaved')+
    panel('Project essentials','<div class="field-grid">'+field('Project name','brief.projectName',b.projectName)+field('Client / brand','brief.clientName',b.clientName)+field('Industry / context','brief.industry',b.industry,{full:true})+field('Primary audience','brief.audience',b.audience,{type:'textarea',rows:3})+field('Primary page goal','brief.goal',b.goal,{type:'textarea',rows:3})+'</div>')+
    panel('Offer and voice','<div class="field-grid">'+field('Core offer','brief.offer',b.offer,{type:'textarea',rows:3})+field('Voice and tone','brief.tone',b.tone,{type:'textarea',rows:3})+field('Useful words / themes','brief.keywords',b.keywords,{full:true,help:'Used as a creative guardrail, not as keyword stuffing.'})+field('Internal notes','brief.notes',b.notes,{type:'textarea',rows:3,full:true})+'</div>')+
    v2GlobalEditors()+renderEditorNav();
};

function v2DialLabel(key,value){
  value=Number(value)||0;
  if(key==='density')return value+' · '+(value<34?'Spacious':value<67?'Balanced':'Compact');
  if(key==='expressiveness')return value+' · '+(value<34?'Restrained':value<67?'Designed':'Bold');
  return value+' · '+(value<10?'Still':value<45?'Subtle':value<75?'Active':'Dynamic');
}
renderDirection=function(){
  var d=state.project.design,arch=DATA.archetypes[d.archetype]||{};
  var choices=Object.entries(DATA.archetypes).map(function(entry){var key=entry[0],a=entry[1];return '<button class="choice '+(key===d.archetype?'selected':'')+'" data-archetype="'+key+'"><div class="choice-code">'+key+' · '+esc(a.polarity)+'</div><b>'+esc(a.name)+'</b><p>'+esc((a.notes||a.paletteIntent||'').slice(0,118))+'</p></button>'}).join('');
  // One catalogue, shared with the brief reader — so a brief that names a
  // typeface names one this select can actually offer.
  var fonts=fontOptions();
  var dials=[
    {key:'density',label:'Density',min:'Spacious',max:'Compact',help:'Changes section rhythm, card padding, grid gaps, content spacing and header height.'},
    {key:'expressiveness',label:'Expression',min:'Restrained',max:'Bold',help:'Changes display scale, image presence, decoration strength, contrast and hover lift.'},
    {key:'motion',label:'Motion',min:'Still',max:'Dynamic',help:'Changes reveal distance, stagger, hover movement and scroll behavior. Zero disables motion.'}
  ];
  return pageHead('02 · Direction','Choose a visual system, not a skin.','Archetypes set polarity, typography, surface behavior and composition rules. The dials now produce visible, system-wide changes without repairing or breaking layout.',d.archetype+' · '+(arch.name||'Custom'))+
    panel('DST visual archetype','<div class="choice-grid">'+choices+'</div>','A–M')+
    panel('Palette and type','<div class="panel-note">The five colors become semantic DST tokens: body, text, accent, supporting surface and inverted ground.</div><div class="palette-row">'+[['bg','Canvas'],['ink','Ink'],['accent','Accent'],['soft','Soft'],['dark','Dark']].map(function(x){return '<label class="color-field"><input type="color" data-bind="design.palette.'+x[0]+'" value="'+escAttr(d.palette[x[0]])+'"><span>'+x[1]+'</span></label>'}).join('')+'</div><div class="field-grid" style="margin-top:16px">'+field('Body typeface','design.fontBody',d.fontBody,{type:'select',options:fonts})+field('Display typeface','design.fontDisplay',d.fontDisplay,{type:'select',options:fonts})+field('Corner language','design.radius',d.radius,{type:'select',full:true,options:[{value:'0px',label:'Square / editorial'},{value:'2px',label:'Almost square'},{value:'8px',label:'Soft utility'},{value:'16px',label:'Friendly rounded'},{value:'28px',label:'Expressive rounded'}]})+'</div>')+
    panel('Design dials','<div class="range-row range-row-detailed">'+dials.map(function(x){return '<div class="range-field" data-dial="'+x.key+'"><label>'+x.label+'<output>'+v2DialLabel(x.key,d[x.key])+'</output></label><input type="range" min="0" max="100" value="'+d[x.key]+'" data-bind="design.'+x.key+'"><div class="range-scale"><span>'+x.min+'</span><span>'+x.max+'</span></div><p class="range-help">'+x.help+'</p></div>'}).join('')+'</div>','Live system controls')+renderEditorNav();
};

var oldEnsureSectionSettingsV1=ensureSectionSettings;
ensureSectionSettings=function(s){
  oldEnsureSectionSettingsV1(s);
  s.layout.heroMediaMode=s.layout.heroMediaMode||'full';
  s.layout.headingAlign=s.layout.headingAlign||'';
  s.layout.headingAlignMobile=s.layout.headingAlignMobile||'';
  return s;
};
renderLayoutEditor=function(s){
  ensureSectionSettings(s);var l=s.layout,e=s.effects,motifs=Object.keys(DATA.decorations).sort();
  var heading=firstNode(s.node,'ds-blocks/c-heading'),ha=heading&&heading.attributes||{};
  var extra='<h3 style="font-size:10px;margin:18px 0 8px">Alignment fidelity</h3><div class="field-grid">'+
    field('Heading alignment',`setting.${s.id}.headingAlign`,l.headingAlign||ha.alignment||'left',{type:'select',options:[{value:'left',label:'Left'},{value:'center',label:'Center'},{value:'right',label:'Right'}]})+
    field('Mobile heading alignment',`setting.${s.id}.headingAlignMobile`,l.headingAlignMobile||ha.alignmentMobile||ha.alignment||'left',{type:'select',options:[{value:'left',label:'Left'},{value:'center',label:'Center'},{value:'right',label:'Right'}]})+'</div>';
  if(s.family==='hero'||s.node.component==='ds-blocks/dst-banner')extra+='<div class="field-grid" style="margin-top:14px">'+field('Hero image treatment',`setting.${s.id}.heroMediaMode`,l.heroMediaMode||'full',{type:'select',full:true,options:[{value:'full',label:'Full-bleed background'},{value:'split-right',label:'Split image · right'},{value:'split-left',label:'Split image · left'}],help:'Full-bleed is the safe default. Split modes are explicit choices, never accidental crops.'})+'</div>';
  return '<div class="field-grid">'+field('Content measure',`setting.${s.id}.container`,l.container,{type:'select',options:[{value:'default',label:'Default container'},{value:'alt',label:'Narrow / alt container'},{value:'wide',label:'Wide container'},{value:'full',label:'Full bleed band'}]})+field('Color treatment',`setting.${s.id}.inverted`,String(l.inverted),{type:'select',options:[{value:'false',label:'Light / standard'},{value:'true',label:'Inverted / dark'}]})+field('Top rhythm',`setting.${s.id}.paddingTop`,l.paddingTop,{type:'select',options:[{value:'none',label:'None'},{value:'small',label:'Small'},{value:'default',label:'Default'},{value:'large',label:'Large'}]})+field('Bottom rhythm',`setting.${s.id}.paddingBottom`,l.paddingBottom,{type:'select',options:[{value:'none',label:'None'},{value:'small',label:'Small'},{value:'default',label:'Default'},{value:'large',label:'Large'}]})+'</div>'+extra+'<h3 style="font-size:10px;margin:18px 0 8px">Motion</h3><div class="field-grid">'+field('Viewport effect',`effect.${s.id}.viewport`,e.viewport||'',{type:'select',options:['','fade','fade-up','fade-down','fade-left','fade-right','zoom-in','slide-up','animate-headings'].map(function(x){return {value:x,label:x||'None'}})})+field('Scroll-driven effect',`effect.${s.id}.scroll`,e.scroll||'',{type:'select',options:['','bg-zoom-in','bg-zoom-out','parallax-bg','parallax-up','parallax-down','scroll-fade','reveal','zoom-scrub','rotate-scrub','cascade','highlight','stack-cards'].map(function(x){return {value:x,label:x||'None'}})})+'</div><h3 style="font-size:10px;margin:18px 0 8px">Decoration</h3><div class="field-grid">'+field('Registered motif',`decoration.${s.id}.motif`,s.decoration&&s.decoration.motif||'',{type:'select',options:[{value:'',label:'None'}].concat(motifs.map(function(x){return {value:x,label:x}}))})+field('Position',`decoration.${s.id}.position`,s.decoration&&s.decoration.position||'cover',{type:'select',options:['cover','top-left','top-right','bottom-left','bottom-right','center','top','bottom'].map(function(x){return {value:x,label:x}})})+'</div><div class="panel-note" style="margin-top:14px;margin-bottom:0">All alignment, container, media and responsive settings are rendered from the DST attributes. The visual dials only change character; they never decide whether a component is structurally correct.</div>';
};

function v2NormalizeAlign(value,fallback){
  var v=String(value||fallback||'left').toLowerCase();
  if(v.indexOf('center')>=0)return 'center';
  if(v.indexOf('right')>=0||v.indexOf('end')>=0)return 'right';
  return 'left';
}
function v2VerticalAlign(value){var v=String(value||'center').toLowerCase();if(v.indexOf('start')>=0||v==='top')return 'start';if(v.indexOf('end')>=0||v==='bottom')return 'end';if(v.indexOf('stretch')>=0)return 'stretch';return 'center'}
function v2CssUnit(value,fallback){if(value==null||value==='')return fallback||'';if(typeof value==='number')return value+'px';return String(value)}
function v2Ratio(value,fallback){var v=String(value||fallback||'16/9').trim();if(/^\d+(?:\.\d+)?x\d+(?:\.\d+)?$/i.test(v))return v.replace(/x/i,'/');if(/^\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?$/.test(v))return v.replace(/\s/g,'');if(v==='custom')return fallback||'16/9';return fallback||'16/9'}
function v2Focal(value){if(value&&typeof value==='object'){var x=Number(value.x),y=Number(value.y);if(Number.isFinite(x)&&x<=1)x*=100;if(Number.isFinite(y)&&y<=1)y*=100;return (Number.isFinite(x)?x:50)+'% '+(Number.isFinite(y)?y:50)+'%'}return String(value||'50% 50%')}
function v2BoxCss(box,property){if(!box||typeof box!=='object')return '';var out=[];['top','right','bottom','left'].forEach(function(side){var raw=box[side],value=raw&&typeof raw==='object'?(raw.desktop||raw.value||raw.type):raw;if(value&& !['default','small','large','none'].includes(String(value)))out.push(property+'-'+side+':'+v2CssUnit(value))});return out.join(';')+(out.length?';':'')}
function v2TypographyCss(obj,skip){if(!obj||typeof obj!=='object')return '';var map={fontFamily:'font-family',fontSize:'font-size',lineHeight:'line-height',letterSpacing:'letter-spacing',fontWeight:'font-weight',textTransform:'text-transform',color:'color',maxWidth:'max-width'};return Object.keys(map).map(function(k){if(skip&&skip.indexOf(k)>=0)return '';return obj[k]!=null&&obj[k]!==''?map[k]+':'+obj[k]+';':''}).join('')}

/*
 * The subtitle keeps the stylesheet's own size.
 *
 * A handful of catalogue patterns — the pricing tiers most visibly — carry a
 * `subtitleTypography.fontSize` of `var(--dst--h2-fs)`, captured from a source
 * design where that slot held a price rather than a supporting line. Rendered
 * as an inline style it beats every stylesheet rule, so a one-sentence subtitle
 * arrives at headline size and the module's rhythm collapses. The size is a
 * pattern accident, not a strategist's choice, so it is dropped on the way out
 * and `.c-heading__sub` falls back to the subtitle token the theme defines.
 */
var HEADING_SUB_SKIP=['fontSize','fontSizeMobile'];

/*
 * Inversion follows the surface, not the pattern attribute.
 *
 * `headingTheme:"inverted"` is captured from whatever ground the block sat on
 * in its source design. Reused here it is a claim about a background this
 * builder may never paint: the pricing tiers ask for inverted text inside
 * columns that render on paper, and `.is-style-colors-inverted` both remaps the
 * colour tokens for the whole subtree and sets `color` outright — so the copy
 * goes white on white and simply disappears.
 *
 * The section already knows whether it is inverted (`layout.inverted`, which
 * `sectionClasses` writes onto the `<section>` itself), and that class cascades
 * to every heading inside it. So a heading only needs the class when it sits on
 * a *different* surface from its section — a column the builder genuinely
 * paints dark. Everything else inherits, which is what the cascade is for.
 */
function v2SurfaceInverted(ctx){
  if(!ctx)return false;
  if(ctx.surfaceInverted!=null)return !!ctx.surfaceInverted;
  return !!(ctx.section&&ctx.section.layout&&ctx.section.layout.inverted);
}

/*
 * The DST colour tokens the preview actually declares, as palette keys.
 *
 * `siteCss` writes these custom properties onto `#sbs-site`, and blocks refer
 * to them by `var(--dst--…)`. Reading a computed value is not an option at
 * render time — the document being described does not exist yet — so the same
 * mapping is mirrored here. It is only ever used to answer "is this surface
 * dark", so a token this table does not know simply defers to the section.
 */
var DST_SURFACE_TOKENS={
  'primary-color1':'dark','primary-color2':'accent','primary-color3':'ink',
  'secondary-color2':'bg','secondary-color3':'soft','secondary-color4':'accent',
  'secondary-color5':'soft','secondary-color6':'accent','secondary-color8':'accent',
  'body-bg':'bg','body-bg-alt':'dark'
};

/** Resolves a background value to a hex colour, or '' when it cannot be known here. */
function v2SurfaceColor(value,project){
  var raw=String(value||'').trim();
  if(!raw)return '';
  if(/^#[0-9a-f]{3,8}$/i.test(raw))return raw;
  var token=raw.match(/^var\(\s*--dst--([a-z0-9-]+)/i);
  if(token){
    if(/^secondary-color(1|7)$/.test(token[1]))return '#ffffff';
    var key=DST_SURFACE_TOKENS[token[1]];
    return key&&project&&project.design?project.design.palette[key]||'':'';
  }
  return '';
}

/**
 * Reads a background value as a ground: true dark, false light, null unknown.
 *
 * Null is the important case. A gradient, a photograph or a token this build
 * does not declare cannot be judged from here, and guessing would be worse than
 * inheriting the surface the block already sits on.
 */
/** The alpha channel of one colour stop, so a see-through stop can be skipped. */
function v2ColorAlpha(value){
  var raw=String(value||'').trim(),rgba=raw.match(/^rgba\(\s*[\d.]+[,\s]+[\d.]+[,\s]+[\d.]+[,\s/]+([\d.]+)/i);
  if(rgba)return clamp(Number(rgba[1]),0,1);
  if(/^#[0-9a-f]{8}$/i.test(raw))return parseInt(raw.slice(7,9),16)/255;
  if(/^#[0-9a-f]{4}$/i.test(raw))return parseInt(raw[4]+raw[4],16)/255;
  if(/^transparent$/i.test(raw))return 0;
  return 1;
}

function v2SurfaceTone(value,project){
  var raw=String(value||'').trim();
  if(!raw)return null;
  /*
   * A gradient scrim is judged by its first opaque stop, not written off as
   * unknowable. That stop is where the copy sits — the p89 v3 hero fades a pale
   * blue from the left across 60% of the band and puts the headline in it, so
   * "gradient, therefore assume a dark photo, therefore white text" produced
   * white on near-white. The first stop is the ground the words are actually on.
   */
  if(/gradient\(/i.test(raw)){
    var stops=raw.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b|\btransparent\b/ig)||[],
      opaque=stops.filter(function(stop){return v2ColorAlpha(stop)>=.5})[0];
    return opaque?v2SurfaceTone(opaque,project):null;
  }
  var rgb=raw.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if(rgb)return (Number(rgb[1])*.2126+Number(rgb[2])*.7152+Number(rgb[3])*.0722)/255<.55;
  var hex=v2SurfaceColor(raw,project);
  if(!hex)return null;
  return relativeLum(hex)<.42;
}

/**
 * Whether a column's own background is dark enough to need light text.
 *
 * The pricing families are the reason this exists: `syncSectionNode` paints the
 * featured tier on the ink token and its neighbours on paper, so one column in
 * three needs inverted copy and the other two must not have it.
 */
function v2ColumnInverted(a,ctx){
  var tone=v2SurfaceTone((a&&a.backgroundColor)||(a&&a.style&&a.style.color&&a.style.color.background),ctx&&ctx.project);
  return tone==null?v2SurfaceInverted(ctx):tone;
}

/** A nested wrapper paints its own background, so it can change the ground mid-section. */
function v2WrapperInverted(a,ctx){
  var tone=v2SurfaceTone(a&&a.backgroundColor,ctx&&ctx.project);
  return tone==null?v2SurfaceInverted(ctx):tone;
}

/**
 * Banners are photo bands: the copy sits over an image behind a scrim, so light
 * text is the ground truth unless the pattern names a light overlay outright.
 */
function v2BannerInverted(a,ctx){
  var tone=v2SurfaceTone(a&&a.backgroundOverlay,ctx&&ctx.project);
  if(tone!=null)return tone;
  return a&&a.backgroundOverlayEnabled===false?v2SurfaceInverted(ctx):true;
}
function v2ContainerName(value,fallback){var v=String(value==null?'':value).trim();if(!v)return fallback||'default';if(['container-alt','alt'].includes(v))return 'alt';if(['container-wide','wide'].includes(v))return 'wide';if(['container-fluid','full','no-container'].includes(v))return 'full';if(v==='container-custom'||v==='custom')return 'custom';return 'default'}
function v2ContainerSpec(attrs,layout,fallback){attrs=attrs||{};layout=layout||{};var name=v2ContainerName(attrs.dsContainer!=null?attrs.dsContainer:layout.container,fallback||'default'),custom=attrs.dsContainerCustom||layout.customWidth||'',align=v2NormalizeAlign(attrs.dsContainerAlign||layout.align||'center','center'),sideGap=attrs.dsContainerSideGap!==false;var cls=name==='alt'?'c-alt':name==='wide'?'c-wide':name==='full'?'c-full':name==='custom'?'c-custom':'c-default';if(!sideGap)cls+=' no-side-padding';var style=[];if(name==='custom'&&custom)style.push('--custom-cw:'+v2CssUnit(custom));if(align==='left')style.push('margin-left:0','margin-right:auto');if(align==='right')style.push('margin-left:auto','margin-right:0');return {className:cls,style:style.join(';')+(style.length?';':'')};}
function v2MediaObject(raw){
  if(!raw)return null;
  if(typeof raw==='string')return {src:raw,alt:'Editorial image'};
  if(raw.src||raw.url)return {src:raw.src||raw.url,alt:raw.alt||raw.title||raw.caption||'Editorial image',source:raw.source||'',intent:raw.intent||'',kind:isVideoMedia(raw)?'video':'image',poster:raw.poster||raw.posterImage||'',ratioDesktop:raw.ratioDesktop,ratioMobile:raw.ratioMobile,fitDesktop:raw.fitDesktop||raw.objectFit,fitMobile:raw.fitMobile,positionDesktop:raw.positionDesktop,positionMobile:raw.positionMobile,caption:raw.caption,hideMobile:!!raw.hideMobile};
  if(raw.media)return v2MediaObject(raw.media);
  if(raw.desktop&&raw.desktop.media){var base=v2MediaObject(raw.desktop.media)||{};base.desktop=raw.desktop;base.mobile=raw.mobile||{};base.alt=base.alt||raw.title||'Editorial image';base.hideMobile=!!raw.hideMobile;return base}
  if(raw.imagePrimary)return v2MediaObject(raw.imagePrimary);
  return null;
}
function v2Rich(value){
  var raw=String(value==null?'':value),out=esc(raw).replace(/\n/g,'<br>');
  out=out.replace(/\*([^*]+)\*/g,'<em>$1</em>');
  out=out.replace(/&lt;(\/?)(strong|em|b|i|br)&gt;/gi,'<$1$2>');
  out=out.replace(/&lt;a\s+href=&quot;([^&]+)&quot;&gt;([\s\S]*?)&lt;\/a&gt;/gi,function(_,href,label){return '<a href="'+escAttr(normalizeLink(href))+'">'+label+'</a>'});
  return out;
}
function v2RenderIcon(icon,label){
  if(icon&&typeof icon==='object'&&String(icon.intent||'').startsWith('intent:inline-svg:')){
    try{var payload=String(icon.intent).slice('intent:inline-svg:'.length),parsed=JSON.parse(decodeURIComponent(payload));if(parsed&&parsed.svg)return parsed.svg}catch(e){}
  }
  var name=typeof icon==='string'?icon:'';var glyph=name.indexOf('mail')>=0?'@':name.indexOf('phone')>=0?'☎':name.indexOf('pin')>=0?'⌖':name.indexOf('clock')>=0?'◷':'✓';return '<span aria-hidden="true">'+glyph+'</span><span class="sr-only">'+esc(label||'Icon')+'</span>';
}
function v2RenderMedia(media,classes,ratio,options){
  var m=v2MediaObject(media),opts=options||{},r=v2Ratio(opts.ratio||m&&m.ratioDesktop||ratio||'16/9','16/9');
  if(!m||!m.src)return '<figure class="ph '+(classes||'')+'" style="--ar:'+escAttr(r)+'"><span class="ph__ico" aria-hidden="true">◇</span><figcaption class="ph__cap">Media placeholder</figcaption></figure>';
  var fit=opts.fit||m.fitDesktop||'cover',pos=opts.position||m.positionDesktop||'50% 50%',mobileFit=m.fitMobile||fit,mobilePos=m.positionMobile||pos,hide=m.hideMobile?' media-hide-mobile':'';
  // Comps are watched, not played: muted autoplay in a loop with no controls is
  // the only behaviour that reads as "moving image" rather than "video player".
  var inner=m.kind==='video'
    ? '<video class="ph__video" autoplay loop muted playsinline preload="metadata"'+(m.poster?' poster="'+escAttr(m.poster)+'"':'')+' aria-label="'+escAttr(m.alt||'Editorial video')+'"><source src="'+escAttr(m.src)+'" type="video/mp4"></video>'
    : '<img loading="lazy" src="'+escAttr(m.src)+'" alt="'+escAttr(m.alt||'Editorial image')+'">';
  return '<figure class="ph ph--photo ph--real '+(classes||'')+hide+'" style="--ar:'+escAttr(r)+';--media-fit:'+escAttr(fit)+';--media-pos:'+escAttr(pos)+';--media-fit-mobile:'+escAttr(mobileFit)+';--media-pos-mobile:'+escAttr(mobilePos)+'">'+inner+(m.caption?'<figcaption class="ph__cap">'+esc(m.caption)+'</figcaption>':'')+'</figure>';
}
function v2BackgroundLayers(raw,fallback){
  var list=Array.isArray(raw)?raw:(raw?[raw]:[]);if(!list.length&&fallback)list=[fallback];return list.map(function(layer,i){var m=v2MediaObject(layer);if(!m||!m.src)return '';var desk=layer&&layer.desktop||m.desktop||{},mob=layer&&layer.mobile||m.mobile||{},fit=desk.size||m.fitDesktop||'cover',mfit=mob.size||m.fitMobile||fit,pos=desk.position||v2Focal(desk.focal||m.positionDesktop),mpos=mob.position||v2Focal(mob.focal||m.positionMobile||pos),style=['--dst--bg-desktop-size:'+fit,'--dst--bg-desktop-focal:'+pos,'--dst--bg-mobile-size:'+mfit,'--dst--bg-mobile-focal:'+mpos];if(desk.width&&desk.width!=='auto')style.push('width:'+desk.width);if(desk.height&&desk.height!=='auto')style.push('height:'+desk.height);if(desk.position&&/^(top|bottom|left|right|center)/.test(desk.position))style.push('object-position:'+desk.position);var overlay=layer&&layer.overlayEnabled?'<span class="c-bg__item-overlay" style="background:'+(layer.overlay||'rgba(0,0,0,.35)')+';opacity:'+(Number(layer.overlayOpacity)==Number(layer.overlayOpacity)?Number(layer.overlayOpacity):1)+'"></span>':'';
  var media=m.kind==='video'
    ? '<video class="c-bg__media c-bg__layer" autoplay loop muted playsinline preload="metadata"'+(m.poster?' poster="'+escAttr(m.poster)+'"':'')+' style="'+escAttr(style.join(';'))+'"><source src="'+escAttr(m.src)+'" type="video/mp4"></video>'
    : '<picture><img class="c-bg__media c-bg__layer" src="'+escAttr(m.src)+'" alt="" loading="'+(i?'lazy':'eager')+'" style="'+escAttr(style.join(';'))+'"></picture>';
  return '<span class="c-bg__item '+(layer&&layer.hideMobile?'no-media-mobile':'')+'" data-bg-layer="'+i+'">'+media+overlay+'</span>'}).join('')}
function v2RenderBackground(raw,attrs,section){attrs=attrs||{};var fallback=section?mediaChoice(section,0):null,layers=v2BackgroundLayers(raw,fallback);if(!layers)return '';var overlay='';if(attrs.backgroundOverlayEnabled!==false&&(attrs.backgroundOverlay||section&&['hero','cta'].includes(section.family))){var bg=cleanCssValue(attrs.backgroundOverlay)||'linear-gradient(90deg,rgba(0,0,0,.78),rgba(0,0,0,.18))',op=Number(attrs.backgroundOverlayOpacity);overlay='<div class="c-overlay" style="background:'+escAttr(bg)+';opacity:'+(Number.isFinite(op)?op:1)+'"></div>'}return '<div class="c-bg">'+layers+'</div>'+overlay}
function v2HeadingSizeClass(a,isHero,nested){var preset=String(a.titleTypography&&a.titleTypography.preset||'');if(isHero||preset.indexOf('h1')>=0)return '-h1';if(nested||preset.indexOf('h3')>=0)return '-h3';if(preset.indexOf('h4')>=0)return '-h4';return '-h2'}
function v2HeadingTag(a,isHero,nested){if(isHero)return 'h1';var tag=String((a.titleTypography&&a.titleTypography.tag)||(nested?'h3':'h2')).toLowerCase();return ['h1','h2','h3','h4','h5','h6','div','p'].includes(tag)?tag:(nested?'h3':'h2')}
function v2RenderHeading(node,ctx){
  var a=node.attributes||{},desktop=v2NormalizeAlign(ctx.section.layout.headingAlign||a.alignment||'left','left'),mobile=v2NormalizeAlign(ctx.section.layout.headingAlignMobile||a.alignmentMobile||desktop,desktop),contentDesktop=v2NormalizeAlign(ctx.section.layout.contentAlign||desktop,desktop),contentMobile=v2NormalizeAlign(ctx.section.layout.contentAlignMobile||contentDesktop,contentDesktop),stateRef=ctx.headingState||(ctx.headingState={h1Used:false}),isHero=ctx.family==='hero'&&!stateRef.h1Used;if(isHero)stateRef.h1Used=true;var tag=v2HeadingTag(a,isHero,ctx.nestedHeading),size=v2HeadingSizeClass(a,isHero,ctx.nestedHeading),title=a.title||'',children=nodeChildren(node,{...ctx,nestedHeading:true,headingAlignment:contentDesktop}),classes=['dst-heading','c-heading','text-'+desktop,'text-'+mobile+'-mobile',desktop==='center'?'-center':'',ctx.topHeading?'mb-s':'',v2SurfaceInverted(ctx)?'is-style-colors-inverted':'',a.headingLayoutVariant==='dst-heading-v2'?'is-heading-split':'',a.keepTabletColumns?'keep-tablet-columns':''].filter(Boolean).join(' '),titleStyle=v2TypographyCss(a.titleTypography),subStyle=v2TypographyCss(a.subtitleTypography,HEADING_SUB_SKIP)+(a.subtitleHasCustomWidth&&a.subtitleCustomWidth?'max-width:'+a.subtitleCustomWidth+';':'');var pre=a.showPretitle!==false&&a.pretitle?'<div class="c-heading__pre" style="'+v2TypographyCss(a.pretitleTypography)+'">'+v2Rich(a.pretitle)+'</div>':'',back=a.backtitle?'<div class="c-heading__preamble '+(a.animateBacktitle?'is-animated':'')+'"><div>'+v2Rich(a.backtitle)+'</div></div>':'',heading=a.showTitle!==false&&title?'<'+tag+' class="c-heading__title '+size+'" style="'+titleStyle+'">'+accentTitle(title,node.titleAccents)+'</'+tag+'>':'',sub=a.showSubtitle!==false&&a.subtitle?'<div class="c-heading__sub text-'+contentDesktop+'" style="'+subStyle+'">'+v2Rich(a.subtitle)+'</div>':'',desc=children?'<div class="c-heading__description text-'+contentDesktop+' text-'+contentMobile+'-mobile">'+children+'</div>':'';if(a.headingLayoutVariant==='dst-heading-v2'&&(sub||desc)){var right=contentDesktop,ratio=String(a.headingColumnsRatio||'50%').replace('%',''),gap=a.headingColumnsGap||'4rem';return '<div class="'+classes+'" data-heading-align="'+desktop+'" data-heading-mobile-align="'+mobile+'" style="--heading-left:'+escAttr(ratio)+'%;--heading-gap:'+escAttr(gap)+'"><div class="c-heading__lead">'+back+pre+heading+'</div><div class="c-heading__support text-'+right+'">'+sub+desc+'</div></div>'}return '<div class="'+classes+'" data-heading-align="'+desktop+'" data-heading-mobile-align="'+mobile+'">'+back+pre+heading+sub+desc+'</div>';
}
/*
 * `groupTheme` used to be able to add inversion and never remove it, so a dark
 * band always got the ghost primary: white fill, dark label. Some bands want the
 * ordinary filled primary instead — the accent with a light label — and there
 * was no way to say so.
 *
 * `groupTheme: 'standard'` says it. It moves the primary only: an *outlined*
 * button has to be drawn in the band's own ink to be visible at all, so the
 * secondary keeps following the band whatever the group asks for.
 */
function v2RenderButton(node,ctx){var a=node.attributes||{};if(!cleanText(a.text))return '';var type=a.btnType||'primary',theme=String(a.groupTheme||''),inverted=ctx.section.layout&&ctx.section.layout.inverted||theme==='inverted',fillInverted=theme==='standard'?false:inverted,cls=type==='link'?'-link':type==='secondary'?(inverted?'-secondary-inverted':'-secondary'):(fillInverted?'-primary-inverted':'-primary'),size=a.btnSize?'-'+a.btnSize:'';var link=normalizeLink(a.link),icon=a.hasIcon!==false?'<span class="sbs-btn-arrow" aria-hidden="true">↗</span>':'';return '<a class="c-btn '+cls+' '+size+'" href="'+escAttr(link)+'" data-dst-component="ds-blocks/c-btn"><span class="c-btn__txt">'+esc(a.text||'Learn more')+'</span>'+icon+'</a>'}
function v2RenderButtonGroup(node,ctx){var a=node.attributes||{},desktop=v2NormalizeAlign(a.justifyContent||ctx.headingAlignment||'left','left'),mobile=v2NormalizeAlign(a.justifyContentMobile||desktop,desktop),vertical=String(a.alignment||'horizontal')==='vertical',gap=v2CssUnit(a.gapBetween||'1.2rem');return '<div class="dst-button-group justify-'+desktop+' justify-'+mobile+'-mobile '+(vertical?'is-vertical':'')+'" style="--button-gap:'+escAttr(gap)+'" data-dst-component="ds-blocks/button-group">'+nodeChildren(node,{...ctx,buttonAlign:desktop})+'</div>'}
function v2CardOverlay(settings){var bg=cleanCssValue(settings.backgroundOverlayEnabled!==false&&settings.backgroundOverlay||settings.mediaOverlay)||'linear-gradient(180deg,rgba(7,28,42,.02),rgba(7,28,42,.92))',op=Number(settings.backgroundOverlayOpacity);return 'background:'+bg+';opacity:'+(Number.isFinite(op)?op:1)+';'}
function v2RenderCard(node,ctx){
  var a=node.attributes||{},s=ctx.cardSettings||{},m=v2MediaObject(a.media),quote=ctx.family==='testimonial'||a.quote,align=v2NormalizeAlign(s.alignment||s.textAlign||'left','left');if(quote)return '<article class="c-block dst-card sbs-quote-card text-'+align+'" data-card-mode="quote"><div class="sbs-quote-mark" aria-hidden="true">“</div><blockquote>'+v2Rich(a.quote||a.description||'')+'</blockquote><div class="c-quote__profile">'+(m?'<span class="c-quote__photo">'+v2RenderMedia(m,'','1/1')+'</span>':'')+'<div class="c-quote__author"><b>'+esc(a.author||a.title||'Client')+'</b><span>'+esc(a.role||a.pretitle||'')+'</span></div></div></article>';
  /*
   * A background-media card puts white type over a photograph behind a scrim.
   * With no photograph there is no scrim either, so the white type lands on the
   * page itself — cream on cream, at about 1.1:1. The card is not "a background
   * card with a missing picture"; without the picture it is a plain card, and
   * saying so here is what keeps its text on the ink colour.
   */
  var hasPicture=!!(m&&m.src);
  var showMedia=s.showMedia!==false&&!!m,bgMode=showMedia&&hasPicture&&!!(s.mediaAsBg||a.mediaAsBg),horizontal=showMedia&&!bgMode&&!!s.isHorizontal,mode=bgMode?'background':horizontal?'side':'top',classes=['c-block','dst-card','dst-card--media-'+mode,horizontal&&String(s.columnsOrder||s.mediaPosition||'').includes('reverse')?'dst-card--flip':'',ctx.family==='gallery'?'sbs-gallery-card':'','text-'+align,'align-'+(s.mediaBgVAlign||'bottom')].filter(Boolean).join(' '),ratio=v2Ratio(s.mediaRatioDesktop||a.mediaRatioDesktop||ctx.family==='team'?'4/5':'4/3','4/3'),style=['--card-ar:'+ratio,'--card-pad:'+v2CssUnit(s.cardItemPadding&&s.cardItemPadding.top||'var(--sbs-card-pad)'),'--card-radius:'+(s.borderRadius==='none'?'0':s.borderRadius==='default'?'var(--dst--default-radius)':s.borderRadius||'var(--dst--default-radius)'),'--c-block__body-padding:'+(s.bodyPadding?([s.bodyPadding.top,s.bodyPadding.right,s.bodyPadding.bottom,s.bodyPadding.left].map(function(x){return v2CssUnit(x||'0')}).join(' ')):'var(--sbs-card-body-pad)')];if(s.backgroundOverlay&&!bgMode)style.push('--card-bg:'+s.backgroundOverlay);if(s.cardBorder&&s.cardBorder.color)style.push('--card-bd:'+(s.cardBorder.width||'1px')+' '+(s.cardBorder.style||'solid')+' '+s.cardBorder.color);var mediaHtml=showMedia?'<div class="c-block__media">'+v2RenderMedia(m,'',ratio,{fit:s.mediaFitDesktop||'cover'})+'</div>':'',scrim=bgMode?'<div class="c-block__scrim" style="'+escAttr(v2CardOverlay(s))+'"></div>':'',icon=s.showIcon!==false&&a.icon?'<div class="c-block__icon"><span class="dst-ico">'+v2RenderIcon(a.icon,a.title)+'</span></div>':'',body='<div class="c-block__body">'+icon+(s.showPretitle!==false&&a.pretitle?'<div class="c-block__tagline">'+v2Rich(a.pretitle)+'</div>':'')+(s.showTitle!==false&&a.title?'<h3 class="c-block__title" style="'+v2TypographyCss(s.titleTypography)+'">'+v2Rich(a.title)+'</h3>':'')+(s.showDescription!==false&&a.description?'<div class="c-block__description" style="'+v2TypographyCss(s.textTypography)+'">'+v2Rich(a.description)+'</div>':'')+(a.button&&a.button.text?'<a class="c-btn -link -small" href="'+escAttr(normalizeLink(a.button.link))+'">'+esc(a.button.text)+'</a>':'')+'</div>';return '<article class="'+classes+'" style="'+escAttr(style.join(';'))+'" data-card-mode="'+mode+'">'+mediaHtml+scrim+body+'</article>';
}
function v2RenderListItem(node,ctx){var a=node.attributes||{},s=ctx.listSettings||{},stats=ctx.family==='stats',align=v2NormalizeAlign(s.style&&s.style.typography&&s.style.typography.textAlign||s.textAlign||'left','left');if(ctx.family==='logo')return '<li class="dst-list__item sbs-logo-item text-'+align+'"><span class="sbs-logo-orb">'+v2Rich(a.listTitle||a.listSubTitle||'Logo')+'</span></li>';var icon=a.icon?'<div class="dst-list__media"><span class="dst-ico sbs-check">'+v2RenderIcon(a.icon,a.listTitle)+'</span></div>':'',hero=a.heroText?'<div class="dst-list__hero '+(stats?'sbs-stat-value':'')+'">'+v2Rich(a.heroText)+'</div>':'';return '<li class="dst-list__item text-'+align+'" data-list-align="'+align+'">'+hero+(!hero?icon:'')+'<div class="dst-list__content">'+(a.listTitle?'<h3 class="dst-list__title">'+v2Rich(a.listTitle)+'</h3>':'')+(a.listSubTitle?'<div class="dst-list__description">'+v2Rich(a.listSubTitle)+'</div>':'')+'</div></li>'}
function v2RenderTabs(node,ctx){var labels=node.attributes&&node.attributes.tabItem||{},tabs=(node.children||[]).filter(function(x){return x.component==='ds-blocks/ds-tab'});return '<div class="dst-tabs sbs-tabs" data-tabs data-dst-component="ds-blocks/ds-tabs"><div class="dst-tabs__navbar" role="tablist">'+tabs.map(function(t,i){return '<button class="dst-tabs__navbar-item sbs-tab-button '+(i===0?'is-active':'')+'" role="tab" aria-selected="'+(i===0)+'" data-tab-index="'+i+'">'+v2Rich(labels[String(i+1)]&&labels[String(i+1)].content||t.attributes&&t.attributes.title||'Tab '+(i+1))+'</button>'}).join('')+'</div><div class="sbs-tab-panels">'+tabs.map(function(t,i){return '<div class="dst-tabs__panel sbs-tab-panel '+(i===0?'is-active':'')+'" role="tabpanel">'+nodeChildren(t,{...ctx,nestedHeading:true})+'</div>'}).join('')+'</div></div>'}
function v2RenderAccordion(node,ctx){var a=node.attributes||{},explicit=(node.children||[]).filter(function(x){return x.component==='ds-blocks/c-accordion-item'}),items=explicit.length?explicit:(a.faqItems||[]).map(function(x,i){return {id:'faq-'+i,attributes:{title:x.title},children:[{component:'core/paragraph',attributes:{content:x.answer||x.content||''},children:[]}]}}),header=(node.children||[]).filter(function(x){return x.component==='ds-blocks/c-heading'}).map(function(x){return renderNode(x,{...ctx,topHeading:true})}).join('');return header+'<div class="dst-accordion '+(a.variant?'accordion-'+a.variant:'')+'" data-dst-component="ds-blocks/c-accordion">'+items.map(function(item,i){var ia=item.attributes||{},answer=(item.children||[]).filter(function(ch){return ch.component==='core/paragraph'}).map(function(ch){return ch.attributes&&ch.attributes.content||ch.text||''}).join(' ');return '<details class="dst-accordion__item" '+(!a.startClosed&&(ia.defaultOpen||i===0)?'open':'')+'><summary class="dst-accordion__q"><span class="dst-accordion__q-t">'+v2Rich(ia.title||'Question '+(i+1))+'</span><span class="dst-accordion__ar is-plus">+</span></summary><div class="dst-accordion__a">'+v2Rich(answer)+'</div></details>'}).join('')+'</div>'}
function v2RenderHorizontalAccordion(node,ctx){var items=node.children||[];return '<div class="sbs-hacc" data-hacc data-dst-component="ds-blocks/dst-hacc">'+items.map(function(item,i){var a=item.attributes||{};return '<article class="sbs-hacc-item '+(a.defaultOpen||i===0?'is-active':'')+'" data-hacc-item><button data-hacc-button><span>'+String(i+1).padStart(2,'0')+'</span><b>'+v2Rich(a.title||'Item '+(i+1))+'</b></button><div class="sbs-hacc-panel">'+(a.showMedia!==false&&a.media?v2RenderMedia(a.media,'','3/2'):'')+'<p>'+v2Rich(a.description||'')+'</p></div></article>'}).join('')+'</div>'}
function v2ColumnStyle(a){var out=[],span=Math.max(1,Math.round(Number(a.columnSpan)||1)),spanT=Math.max(1,Math.round(Number(a.columnSpanTablet)||1)),spanM=Math.max(1,Math.round(Number(a.columnSpanMobile)||1));out.push('--column-span:'+span,'--column-span-t:'+spanT,'--column-span-m:'+spanM);if(a.backgroundColor)out.push('background:'+a.backgroundColor);if(a.style&&a.style.color&&a.style.color.background)out.push('background:'+a.style.color.background);out.push(v2BoxCss(a.colPadding,'padding'));if(a.alignVertical)out.push('align-self:'+({top:'start',center:'center',bottom:'end',stretch:'stretch'}[a.alignVertical]||a.alignVertical));if(a.alignHorizontal)out.push('text-align:'+({left:'left',center:'center',right:'right',stretch:'left'}[a.alignHorizontal]||a.alignHorizontal));if(a.widthMode==='fixed'&&a.fixedWidth){out.push('width:'+v2CssUnit(a.fixedWidth),'max-width:100%','justify-self:'+({left:'start',center:'center',right:'end'}[a.alignHorizontal]||'start'))}return out.filter(Boolean).join(';')}
function v2RenderNode(node,ctx){
  if(!node)return '';var a=node.attributes||{},comp=node.component;
  switch(comp){
    case 'ds-blocks/dst-wrapper':{var isTop=!!ctx.top,spec=v2ContainerSpec(a,node.layout,isTop?ctx.section.layout.container:'full'),rawBg=a.backgroundImage||null,hasBg=Array.isArray(rawBg)?rawBg.length:!!rawBg,bg=hasBg?v2RenderBackground(rawBg,a,ctx.section):'',bgStyle=a.backgroundColor?'background:'+a.backgroundColor+';':'',classes=['dst-wrapper',isTop?'c-full':'',isTop?sectionClasses(ctx.section):'',isTop?sectionBgClass(ctx.section,ctx.sectionIndex):'',hasBg?'has-bg-media':'',ctx.section.layout.inverted?'is-style-colors-inverted':''].filter(Boolean).join(' '),inner='<div class="dst-wrapper__inner '+spec.className+'" style="'+escAttr(spec.style)+'">'+nodeChildren(node,{...ctx,top:false,topHeading:true,surfaceInverted:isTop?v2SurfaceInverted(ctx):v2WrapperInverted(a,ctx)})+'</div>';if(isTop)return '<section id="'+escAttr(ctx.section.id)+'" class="'+classes+'" style="'+escAttr(bgStyle)+'" '+effectAttrs(ctx.section)+' data-dst-component="'+comp+'">'+bg+renderDecoration(ctx.section)+'<div class="dst-wrapper__content">'+inner+'</div></section>';return '<div class="dst-wrapper '+(hasBg?'has-bg-media':'')+'" style="'+escAttr(bgStyle)+'" data-dst-component="'+comp+'">'+bg+'<div class="dst-wrapper__content">'+inner+'</div></div>'}
    case 'ds-blocks/dst-banner':{var bh=a.bannerHeight|| (ctx.family==='hero'?'full':'medium'),heightClass=bh==='full'?'bh-full':bh==='small'?'bh-sm':bh==='medium'?'bh-md':'bh-auto',heightStyle=bh==='custom'&&a.bannerHeightCustom?'min-height:'+a.bannerHeightCustom+';':'',innerSpec=v2ContainerSpec({dsContainer:a.innerContainerWidth,dsContainerCustom:a.innerContainerWidthCustom,dsContainerSideGap:true,dsContainerAlign:'center'},null,'default'),desktop=v2NormalizeAlign(ctx.section.layout.headingAlign||a.horizontalAlign||'left','left'),mobile=v2NormalizeAlign(ctx.section.layout.headingAlignMobile||a.horizontalAlignMobile||desktop,desktop),vertical=v2VerticalAlign(a.innerVerticalAlign||'center'),contentWidth=a.contentWidth||'100%',mode=ctx.section.layout.heroMediaMode||'full',media=a.backgroundImage&&a.backgroundImage.length?a.backgroundImage:mediaChoice(ctx.section,0),bg=v2RenderBackground(media,a,ctx.section),classes=['dst-banner',heightClass,'c-full',sectionClasses(ctx.section),ctx.family==='hero'?'sbs-hero':'',ctx.family==='cta'?'sbs-cta':'','hero-media-'+mode,a.borderRadius&&a.borderRadius!=='none'?'has-banner-radius':''].filter(Boolean).join(' '),style=heightStyle+(a.borderRadius==='custom'&&a.borderRadiusCustom?'border-radius:'+a.borderRadiusCustom+';':'');return '<section id="'+escAttr(ctx.section.id)+'" class="'+classes+'" style="'+escAttr(style)+'" '+effectAttrs(ctx.section)+' data-dst-component="'+comp+'">'+bg+renderDecoration(ctx.section)+'<div class="dst-banner__container '+innerSpec.className+' align-'+desktop+' align-'+mobile+'-mobile valign-'+vertical+'" style="'+escAttr(innerSpec.style)+'"><div class="dst-banner__inner" style="--cw:'+escAttr(contentWidth)+'">'+nodeChildren(node,{...ctx,top:false,topHeading:true,surfaceInverted:v2BannerInverted(a,ctx)})+'</div></div>'+(a.showScrollDown||ctx.family==='hero'?'<a class="scroll-down '+escAttr(a.scrollDownPosition||'sd-left')+'" href="#'+escAttr(ctx.project.sections[1]&&ctx.project.sections[1].id||'main')+'"><span>'+esc(a.scrollDownText||'Explore')+'</span><span aria-hidden="true">⌄</span></a>':'')+'</section>'}
    case 'ds-blocks/c-heading':return v2RenderHeading(node,ctx);
    case 'ds-blocks/button-group':return v2RenderButtonGroup(node,ctx);
    case 'ds-blocks/c-btn':return v2RenderButton(node,ctx);
    case 'ds-blocks/simple-text':return '<div class="sbs-rich-text" data-dst-component="'+comp+'">'+nodeChildren(node,ctx)+'</div>';
    case 'core/paragraph':return '<p>'+v2Rich(a.content||node.text||a.placeholder||'')+'</p>';
    case 'core/list':return '<ul class="sbs-core-list">'+nodeChildren(node,ctx)+'</ul>';
    case 'core/list-item':return '<li>'+v2Rich(a.content||node.text||'')+'</li>';
    case 'core/html':return '<div class="sbs-html-note">'+v2Rich(stripHtml(a.content||''))+'</div>';
    case 'ds-blocks/l-content-2':{var media=a.media&&v2MediaObject(a.media)?a.media:mediaChoice(ctx.section,0),flip=String(a.columnsOrder||'').includes('reverse'),ratio=Number(a.contentRatio||a.columnsRatio||46),gap=a.columnsGap||a.gap||'clamp(4rem,7vw,11rem)',spec=v2ContainerSpec(a,node.layout,ctx.top?ctx.section.layout.container:'full');return '<div class="dst-content2 '+(ctx.top?spec.className:'')+'" style="'+escAttr(spec.style)+'" data-dst-component="'+comp+'"><div class="dst-content2__block '+(flip?'sbs-flip':'')+'" style="--content-ratio:'+ratio+'%;--content-gap:'+escAttr(gap)+'"><div class="dst-content2__col sbs-copy-col">'+nodeChildren(node,{...ctx,top:false,topHeading:true})+'</div><div class="dst-content2__col sbs-media-col">'+v2RenderMedia(media,'sbs-feature-media',a.mediaRatioDesktop||'4/3',{fit:a.mediaFitDesktop||'cover'})+'</div></div></div>'}
    case 'ds-blocks/ds-columns':{var count=Math.max(1,Number(a.desktopColumnsPerRow||a.count||(node.children||[]).length||1)),tablet=Math.max(1,Number(a.tabletCount||a.flexItemsPerRowTablet||Math.min(2,count))),mobile=Math.max(1,Number(a.mobileCount||a.flexItemsPerRowMobile||1)),spec=v2ContainerSpec(a,node.layout,ctx.top?ctx.section.layout.container:'full'),gap=a.gap||'3rem',gapT=a.gapTablet||gap,gapM=a.gapMobile||'2rem',valign=v2VerticalAlign(a.verticalAlign||'stretch'),content='<div class="ds-row layout-'+(a.layoutVariant||'grid')+' valign-'+valign+'" style="--cols:'+Math.min(count,12)+';--cols-t:'+Math.min(tablet,6)+';--cols-m:'+Math.min(mobile,3)+';--col-gap:'+escAttr(gap)+';--col-gap-t:'+escAttr(gapT)+';--col-gap-m:'+escAttr(gapM)+'">'+nodeChildren(node,{...ctx,top:false})+'</div>';return '<div class="ds-columns '+(ctx.top?spec.className:'')+'" style="'+escAttr(ctx.top?spec.style:'')+'" data-dst-component="'+comp+'">'+content+'</div>'}
    case 'ds-blocks/ds-column':return '<div class="ds-column" style="'+escAttr(v2ColumnStyle(a))+'" data-dst-component="'+comp+'">'+nodeChildren(node,{...ctx,nestedHeading:true,surfaceInverted:v2ColumnInverted(a,ctx)})+'</div>';
    case 'ds-blocks/c-media':return '<div class="dst-media" data-dst-component="'+comp+'">'+v2RenderMedia(a.media&&v2MediaObject(a.media)?a.media:mediaChoice(ctx.section,ctx.childIndex||0),'',a.mediaRatioDesktop||'4/3',{fit:a.mediaFitDesktop||'cover'})+'</div>';
    case 'ds-blocks/c-cards':{var slider=!!(a.enableDstSlider||a.enableSlider||a.slider||ctx.family==='slider'||ctx.family==='testimonial'),cols=Math.max(1,Number(a.columnsDesktop||a.columns||3)),colT=Math.max(1,Number(a.columnsTablet||Math.min(2,cols))),colM=Math.max(1,Number(a.columnsMobile||1)),settings=a.dstSliderSettings||{},align=v2NormalizeAlign(a.alignment||'left','left'),classes=['dst-cards',slider?'has-dst-slider-bleed-right':'',a.enableStickyCards?'has-sticky-cards':''].filter(Boolean).join(' '),gridClasses=['dst-cards__grid',slider?'dst-slider':'','text-'+align,a.isHorizontal?'is-horizontal':'',settings.bleedRight?'has-right-bleed':'',settings.bleedBoth?'has-both-sides-bleed':'',a.enableStickyCards?'cards-sticky cards-sticky-'+(a.stickyPosition||'top'):''].filter(Boolean).join(' '),style='--col:'+cols+';--col-t:'+colT+';--col-m:'+colM+';--card-gap-x:'+escAttr(a.gapHorizontal||'var(--sbs-grid-gap)')+';--card-gap-y:'+escAttr(a.gapVertical||'var(--sbs-grid-gap)')+';--dst-slider-cols:'+Math.min(cols,Number(settings.bleedRightVisibleItems||3))+';';var cards='<div class="'+gridClasses+'" style="'+style+'">'+nodeChildren(node,{...ctx,inCards:true,cardSettings:a})+'</div>',controls=slider?'<div class="dst-slider__controls" data-arrows-position="'+escAttr(settings.arrowsPosition||'bottom')+'">'+(settings.showProgress!==false?'<div class="dst-slider__progress"><div class="dst-slider__progress-fill"></div></div>':'')+'<div class="dst-slider__nav"><button class="dst-slider__arrows -prev" aria-label="Previous">'+ICONS.arrow+'</button><button class="dst-slider__arrows -next" aria-label="Next">'+ICONS.arrow+'</button></div></div>':'';return '<div class="'+classes+'" '+(slider?'data-slider':'')+' data-dst-component="'+comp+'">'+cards+controls+'</div>'}
    case 'ds-blocks/c-card-item':{var span=[];if(a.gridColumnSpan)span.push('grid-column:span '+Number(a.gridColumnSpan));if(a.gridRowSpan)span.push('grid-row:span '+Number(a.gridRowSpan));return '<div class="dst-cards__item" style="'+escAttr(span.join(';'))+'" data-dst-component="'+comp+'">'+v2RenderCard(node,ctx)+'</div>'}
    case 'ds-blocks/c-list':{var timeline=a.enableTimeline||a.layoutVariant==='timeline'||ctx.family==='timeline',cols=timeline?1:Math.max(1,Number(a.colCount||1)),ct=timeline?1:Math.max(1,Number(a.colCountTablet||Math.min(2,cols))),cm=timeline?1:Math.max(1,Number(a.colCountMobile||1)),align=v2NormalizeAlign(a.style&&a.style.typography&&a.style.typography.textAlign||'left','left'),spec=v2ContainerSpec(a,node.layout,'full'),classes=['dst-list',timeline?'list-timeline':'','text-'+align,a.layoutVariant==='flex'?'list-flex':'',a.enableBorder?'has-border':''].filter(Boolean).join(' '),style='--dst-list__col:'+cols+';--dst-list__col-tablet:'+ct+';--dst-list__col-mobile:'+cm+';--dst-list__row-gap:'+escAttr(a.gapVertical||a.gapBetween||'2.4rem')+';--dst-list__element-gap:'+escAttr(a.gapBetweenContent||'1.8rem')+';';return '<div class="'+spec.className+' no-side-padding '+classes+'" style="'+escAttr(spec.style+style)+'" '+(a.heroIsCounter||ctx.family==='stats'?'data-counter="true"':'')+' data-dst-component="'+comp+'"><ul class="dst-list__grid">'+nodeChildren(node,{...ctx,listTimeline:timeline,listSettings:a})+'</ul></div>'}
    case 'ds-blocks/c-list-item':return v2RenderListItem(node,ctx);
    case 'ds-blocks/ds-tabs':return v2RenderTabs(node,ctx);
    case 'ds-blocks/ds-tab':return nodeChildren(node,ctx);
    case 'ds-blocks/c-accordion':return v2RenderAccordion(node,ctx);
    case 'ds-blocks/c-accordion-item':return '';
    case 'ds-blocks/dst-hacc':return v2RenderHorizontalAccordion(node,ctx);
    case 'ds-blocks/dst-hacc-item':return '';
    case 'ds-blocks/marquee':{var logos=a.images||[],all=logos.concat(logos);return '<div class="dst-marquee" data-dst-component="'+comp+'"><div class="dst-marquee__track" style="--dur:'+(a.speed||28)+'s">'+all.map(function(x){var m=v2MediaObject(x);return m&&m.src?'<img class="dst-marquee__img" src="'+escAttr(m.src)+'" alt="'+escAttr(m.alt||'Logo')+'">':'<span class="dst-marquee__logo">'+esc(x.label||x.alt||x.title||'WORDMARK')+'</span>'}).join('')+'</div></div>'}
    case 'gravityforms/form':return '<div class="sbs-form-slot" id="contact"><div class="sbs-form-slot__head"><span>Gravity Forms</span><b>Production form slot</b></div><div class="sbs-form-mock" aria-hidden="true"><span></span><span></span><span class="wide"></span><i>Submit</i></div><p>'+esc(a.placeholder||'Connect the production form in WordPress.')+'</p></div>';
    case 'ds-blocks/dst-banner-slider':return '<div class="sbs-banner-slider" data-slider data-dst-component="'+comp+'">'+nodeChildren(node,ctx)+'</div>';
    case 'ds-blocks/dst-banner-slide':return '<div class="sbs-banner-slide" data-dst-component="'+comp+'">'+nodeChildren(node,ctx)+'</div>';
    case 'ds-blocks/images-group':{var imgs=a.images||a.media||[];return '<div class="sbs-images-group" data-dst-component="'+comp+'">'+(Array.isArray(imgs)?imgs:[]).map(function(x){return v2RenderMedia(x,'','4/3')}).join('')+nodeChildren(node,ctx)+'</div>'}
    case 'ds-blocks/dst-testimonials-slider':return '<div class="dst-testi__track" data-slider data-dst-component="'+comp+'">'+nodeChildren(node,{...ctx,family:'testimonial'})+'</div>';
    case 'ds-blocks/c-compare':return '<div class="dst-compare__pair" data-dst-component="'+comp+'">'+nodeChildren(node,ctx)+'</div>';
    case 'ds-blocks/c-icon':return '<span class="dst-ico" data-dst-component="'+comp+'">'+v2RenderIcon(a.icon||a.iconValue,a.label||'Icon')+'</span>';
    case 'ds-blocks/dst-spacer':return '<div class="dst-spacer" style="height:'+escAttr(v2CssUnit(a.height||a.desktopHeight||'4rem'))+'" aria-hidden="true"></div>';
    case 'ds-blocks/dst-block-title':return '<div class="dst-block-title">'+(a.title?'<h3>'+v2Rich(a.title)+'</h3>':'')+nodeChildren(node,ctx)+'</div>';
    case 'ds-blocks/c-inner-menu':return '<nav class="sbs-inner-menu">'+(a.items||[]).map(function(x){return '<a href="'+escAttr(normalizeLink(x.url))+'">'+esc(x.label)+'</a>'}).join('')+nodeChildren(node,ctx)+'</nav>';
    case 'ds-blocks/c-megamenu-inner':return '<div class="sbs-megamenu-inner">'+nodeChildren(node,ctx)+'</div>';
    default:return nodeChildren(node,ctx);
  }
}
renderHeading=v2RenderHeading;renderButton=v2RenderButton;renderCard=v2RenderCard;renderListItem=v2RenderListItem;renderTabs=v2RenderTabs;renderAccordion=v2RenderAccordion;renderHorizontalAccordion=v2RenderHorizontalAccordion;renderMediaValue=v2RenderMedia;renderBackground=function(media,family){return v2RenderBackground(media,{},null)};renderNode=v2RenderNode;

renderSection=function(section,index,project){ensureSectionSettings(section);syncSectionNode(section);var ctx={section:section,sectionIndex:index,project:project,family:section.family,top:true,topHeading:true,headingState:{h1Used:false},nestedHeading:false};if(['ds-blocks/dst-wrapper','ds-blocks/dst-banner'].includes(section.node.component))return renderNode(section.node,ctx);var spec=v2ContainerSpec({},section.layout,'default');return '<section id="'+escAttr(section.id)+'" class="dst-wrapper c-full '+sectionClasses(section)+' '+sectionBgClass(section,index)+'" '+effectAttrs(section)+'>'+renderDecoration(section)+'<div class="dst-wrapper__inner '+spec.className+'" style="'+escAttr(spec.style)+'">'+renderNode(section.node,{...ctx,top:false})+'</div></section>'};
/**
 * The site identity, as either a real logo or the initials placeholder.
 *
 * A supplied logo file *is* the brand mark: it already contains the wordmark, so
 * repeating the name beside it gives every page two logos. The image therefore
 * replaces the mark and the text outright and carries the name as its alt, which
 * is also the only reading a screen reader needs. `title` is the longer
 * description when one is written, so the tooltip and the accessible name can
 * differ without either being noise.
 */
function v2LogoHtml(text,mark,url,alt,description){
  if(!url)return '<span class="sbs-logo-mark">'+esc(mark||v2Initials(text))+'</span>';
  var label=cleanText(alt)||cleanText(text)||'Site logo',note=cleanText(description);
  return '<img class="sbs-logo-image" src="'+escAttr(url)+'" alt="'+escAttr(label)+'"'+(note?' title="'+escAttr(note)+'"':'')+'>';
}
/** True when the identity is an image, and therefore already says the name. */
function v2HasLogoImage(part){return !!cleanText(part&&part.logoUrl)}
renderHeader=function(project){v2EnsureProject(project);var h=project.header,b=project.brief,items=h.nav||[],variant=headerVariant(h.variant),position=h.position||'sticky',classes=['site-header','is-'+position,h.frostedGlass?'has-glass':'',variant==='centered'?'logo-center':'','header-'+variant,h.hideOnScrollDown?'hide-on-scroll':''].filter(Boolean).join(' '),announcement=h.announcement?'<div class="site-header__ann"><div class="c-default"><span>'+v2Rich(h.announcement)+'</span>'+(h.announcementDismissible?'<button class="site-header__dismiss" aria-label="Dismiss announcement">×</button>':'')+'</div></div>':'',nav='<nav class="nav-menu">'+items.map(function(x,i){return '<a href="'+escAttr(normalizeLink(x[1]))+'" style="--nav-i:'+i+'" data-nav-index="'+String(i+1).padStart(2,'0')+'"><span class="nav-menu__label">'+esc(x[0])+'</span></a>'}).join('')+'</nav>',cta=h.cta&&h.cta.text?'<a class="c-btn -primary -small sbs-header-cta" href="'+escAttr(normalizeLink(h.cta.link||'#contact'))+'">'+esc(h.cta.text)+'</a>':'';return '<header class="'+classes+'" data-dst-component="ds-blocks/dst-navigation" data-header-variant="'+escAttr(variant)+'" data-mobile-menu="'+escAttr(mobileMenuStyle(h.mobileMenu))+'">'+announcement+'<div class="site-header__row c-default"><a class="site-header__logo'+(v2HasLogoImage(h)?' has-logo-image':'')+'" href="#top">'+v2LogoHtml(h.logoText||b.clientName,h.logoMark,h.logoUrl,h.logoAlt,h.logoDescription)+(v2HasLogoImage(h)?'':'<span class="site-header__logo-text">'+esc(h.logoText||b.clientName)+'</span>')+'</a><button class="sbs-menu-toggle" aria-expanded="false" aria-label="Open navigation"><span></span><span></span><span></span></button>'+nav+cta+'</div></header>'};
renderFooter=function(project){v2EnsureProject(project);var f=project.footer,b=project.brief,columns=f.columns||[],socials=f.socials||[],privacy=f.privacyLinks||[],cta=f.cta&&f.cta.text?'<a class="c-btn -primary-inverted" href="'+escAttr(normalizeLink(f.cta.link||'#contact'))+'">'+esc(f.cta.text)+' <span aria-hidden="true">↗</span></a>':'';return '<footer class="site-footer is-style-colors-inverted sbs-footer footer-'+escAttr(footerVariant(f.variant))+'" data-dst-component="global-footer"><div class="c-default"><div class="footer__top sbs-footer-statement"><span class="c-heading__pre">'+esc(f.logoText||b.clientName)+'</span><h2 class="footer__nl-head">'+v2Rich(f.statement)+'</h2><p class="footer__nl-sub">'+v2Rich(f.description)+'</p>'+cta+'</div><div class="footer__divider"></div><div class="footer__cols"><div class="footer__col footer__brand"><div class="site-header__logo sbs-footer-logo'+(v2HasLogoImage(f)?' has-logo-image':'')+'">'+v2LogoHtml(f.logoText||b.clientName,f.logoMark,f.logoUrl,f.logoAlt,f.logoDescription)+(v2HasLogoImage(f)?'':'<span>'+esc(f.logoText||b.clientName)+'</span>')+'</div><p>'+v2Rich(b.offer||f.description)+'</p><div class="dst-socials">'+socials.map(function(s){return '<a class="dst-social" href="'+escAttr(normalizeLink(s.url||'#'))+'" aria-label="'+escAttr(s.label||s.network)+'">'+esc((s.network||s.label||'?').slice(0,2))+'</a>'}).join('')+'</div></div>'+columns.map(function(col){return '<div class="footer__col"><h4>'+esc(col.title)+'</h4><ul class="footer__menu">'+(col.links||[]).map(function(x){return '<li><a href="'+escAttr(normalizeLink(x[1]))+'">'+esc(x[0])+'</a></li>'}).join('')+'</ul></div>'}).join('')+'</div><div class="footer__bottom"><div class="footer__legal">'+esc(f.legal)+'</div><ul class="footer__privacy">'+privacy.map(function(x){return '<li><a href="'+escAttr(normalizeLink(x[1]))+'">'+esc(x[0])+'</a></li>'}).join('')+'</ul></div></div><div class="footer__wordmark is-bottom" aria-hidden="true">'+esc(f.wordmark||String(f.logoText||b.clientName).split(' ')[0])+'</div></footer>'};

effectAttrs=function(section){var e=section.effects||{},motion=Number(state.project.design.motion)||0,parts=[];if(motion<=4)return '';if(e.viewport)parts.push('data-viewport="true" data-viewport-effect="'+escAttr(e.viewport)+'" data-viewport-repeat="'+String(!!e.repeat)+'"');if(e.scroll&&motion>=35)parts.push('data-scroll="true" data-scroll-effect="'+escAttr(e.scroll)+'"');return parts.join(' ')};
siteCss=function(project){
  var base=legacySiteCssV1(project),d=project.design,p=d.palette,den=clamp(Number(d.density)||0,0,100)/100,exp=clamp(Number(d.expressiveness)||0,0,100)/100,mot=clamp(Number(d.motion)||0,0,100)/100,sectionGap=(12.6-6.2*den).toFixed(2),smallGap=(7.2-3.6*den).toFixed(2),largeGap=(16.2-6.4*den).toFixed(2),cardPad=(4.6-2.3*den).toFixed(2),cardBody=(3.5-1.3*den).toFixed(2),gridGap=(3.6-2.0*den).toFixed(2),headerH=Math.round(96-24*den),h1vw=(4.9+4.1*exp).toFixed(2),h1max=(7.6+5.2*exp).toFixed(2),h2vw=(3.2+2.0*exp).toFixed(2),h2max=(5.2+2.8*exp).toFixed(2),decorScale=(.72+.72*exp).toFixed(2),motionDuration=mot<.05?'0s':(.22+.52*mot).toFixed(2)+'s',motionDistance=Math.round(8+54*mot),hoverLift=Math.round(1+8*mot),motionLevel=mot<.05?'none':mot<.45?'subtle':mot<.75?'active':'dynamic';
  return base+'\n'+`#sbs-site.ver{--dst--desktop-vertical-gap:${sectionGap}vmin;--dst--vgap-s:${smallGap}vmin;--dst--vgap-l:${largeGap}vmin;--dst--header-height:${headerH}px;--dst--fs-h1:clamp(4.2rem,${h1vw}vw,${h1max}rem);--dst--fs-h2:clamp(3rem,${h2vw}vw,${h2max}rem);--sbs-card-pad:${cardPad}rem;--sbs-card-body-pad:${cardBody}rem;--sbs-grid-gap:${gridGap}rem;--sbs-decor-scale:${decorScale};--sbs-motion-duration:${motionDuration};--sbs-motion-distance:${motionDistance}px;--sbs-hover-lift:${hoverLift}px;--sbs-body-lh:${(1.72-.16*den).toFixed(2)};--dst--h1-ff:var(--dst--font-secondary);--dst--h1-fs:var(--dst--fs-h1);--dst--h1-fsM:clamp(4rem,14vw,7rem);--dst--h1-lh:1.02;--dst--h1-ls:-.04em;--dst--h1-fw:600;--dst--h1-tt:none;--dst--h2-ff:var(--dst--font-secondary);--dst--h2-fs:var(--dst--fs-h2);--dst--h2-fsM:clamp(3rem,10vw,5.2rem);--dst--h2-lh:1.08;--dst--h2-ls:-.03em;--dst--h2-fw:600;--dst--h2-tt:none;--dst--h3-ff:var(--dst--font-secondary);--dst--h3-fs:var(--dst--fs-h3);--dst--h3-fsM:clamp(2.4rem,7vw,3.6rem);--dst--h3-lh:1.16;--dst--h3-ls:-.02em;--dst--h3-fw:600;--dst--h3-tt:none;--dst--h4-ff:var(--dst--font-primary);--dst--h4-fs:var(--dst--fs-h4);--dst--h4-fsM:clamp(1.9rem,5vw,2.4rem);--dst--h4-lh:1.25;--dst--h4-ls:-.01em;--dst--h4-fw:650;--dst--h4-tt:none;--dst--pretitle-ff:var(--dst--font-primary);--dst--pretitle-fs:var(--dst--fs-pretitle);--dst--pretitle-fsM:var(--dst--fs-pretitle);--dst--pretitle-lh:1.2;--dst--pretitle-ls:.16em;--dst--pretitle-fw:700;--dst--pretitle-tt:uppercase;--dst--subtitle-ff:var(--dst--font-primary);--dst--subtitle-fs:var(--dst--fs-subtitle);--dst--subtitle-fsM:var(--dst--fs-subtitle);--dst--subtitle-lh:1.6;--dst--subtitle-fw:400;--dst--btn-font-size:var(--dst--btn-fs);--dst--smaller-text-size:1.4rem;--dst--base-text-size:var(--dst--fs-base)}
#sbs-site{line-height:var(--sbs-body-lh)}
.c-custom{width:100%;max-width:var(--custom-cw,1200px);margin-inline:auto;padding-inline:2.4rem}.no-side-padding{padding-inline:0!important}
.c-heading.text-center,.c-heading.-center{text-align:center}.c-heading.text-center>*:not(.c-heading__preamble),.c-heading.-center>*:not(.c-heading__preamble){margin-left:auto;margin-right:auto}.c-heading.text-right{text-align:right}.c-heading.text-right>*:not(.c-heading__preamble){margin-left:auto;margin-right:0}.c-heading.text-left>*:not(.c-heading__preamble){margin-left:0;margin-right:auto}.c-heading.text-center .c-heading__description,.c-heading.-center .c-heading__description{align-items:center;justify-content:center}.c-heading.text-right .c-heading__description{align-items:flex-end;justify-content:flex-end}.c-heading__sub,.c-heading__title,.sbs-rich-text{width:fit-content;max-width:100%}.c-heading__sub{width:auto}.c-heading__description{width:100%}
.is-heading-split{display:grid;grid-template-columns:minmax(0,var(--heading-left,50%)) minmax(0,1fr);gap:var(--heading-gap,4rem);align-items:end}.is-heading-split .c-heading__lead,.is-heading-split .c-heading__support{min-width:0}.is-heading-split .c-heading__support.text-right{text-align:right}.is-heading-split .c-heading__support.text-center{text-align:center}.is-heading-split .c-heading__support.text-center>*{margin-inline:auto}.is-heading-split .c-heading__support.text-right>*{margin-left:auto}
.c-bg,.c-overlay,.c-bg__item,.c-bg__item>picture{position:absolute!important;inset:0;width:100%;height:100%}.c-bg__media,.c-bg__layer{display:block;width:100%!important;height:100%!important;max-width:none;object-fit:var(--dst--bg-desktop-size,cover)!important;object-position:var(--dst--bg-desktop-focal,50% 50%)!important}.c-bg__item-overlay{position:absolute;inset:0;pointer-events:none}.dst-banner,.has-bg-media{isolation:isolate}.dst-banner__inner{width:100%;max-width:var(--cw,100%)}.dst-banner__container.align-center{align-items:center;text-align:center}.dst-banner__container.align-right{align-items:flex-end;text-align:right}.dst-banner__container.valign-start{justify-content:flex-start}.dst-banner__container.valign-center{justify-content:center}.dst-banner__container.valign-end{justify-content:flex-end}
.sbs-hero .c-bg{inset:0!important;width:100%!important;left:0!important}.sbs-hero .c-overlay{opacity:1}.sbs-hero.hero-media-full .dst-banner__inner{max-width:min(86rem,70vw)}.sbs-hero.hero-media-split-right .c-bg{left:auto!important;width:55%!important}.sbs-hero.hero-media-split-left .c-bg{right:auto!important;width:55%!important}.sbs-hero.hero-media-split-left .dst-banner__container{align-items:flex-end}.sbs-hero.hero-media-split-left .c-overlay{background:linear-gradient(270deg,${p.dark} 0%,${p.dark} 38%,transparent 88%)}.sbs-hero.hero-media-split-right .c-overlay{background:linear-gradient(90deg,${p.dark} 0%,${p.dark} 38%,transparent 88%)}
.dst-button-group{display:flex;gap:var(--button-gap,1.2rem)}.dst-button-group.justify-center{justify-content:center}.dst-button-group.justify-right{justify-content:flex-end}.dst-button-group.is-vertical{flex-direction:column;align-items:flex-start}.dst-button-group.is-vertical.justify-center{align-items:center}.dst-button-group.is-vertical.justify-right{align-items:flex-end}
.ds-row{display:grid;grid-template-columns:repeat(var(--cols,1),minmax(0,1fr));gap:var(--col-gap,var(--sbs-grid-gap));align-items:stretch}.ds-row>.ds-column{grid-column:span var(--column-span,1);min-width:0;max-width:100%}.ds-row.valign-start{align-items:start}.ds-row.valign-center{align-items:center}.ds-row.valign-end{align-items:end}.ds-row.layout-flex{display:flex;flex-wrap:wrap}.ds-row.layout-flex>.ds-column{flex:1 1 calc((100% - (var(--cols,1) - 1)*var(--col-gap,var(--sbs-grid-gap)))/var(--cols,1))}
.dst-content2__block{gap:var(--content-gap,clamp(4rem,7vw,11rem))}.dst-content2__col.sbs-copy-col{flex:0 1 var(--content-ratio,46%)}.dst-content2__col.sbs-media-col{flex:1 1 calc(100% - var(--content-ratio,46%))}
.dst-cards__grid{column-gap:var(--card-gap-x,var(--sbs-grid-gap));row-gap:var(--card-gap-y,var(--sbs-grid-gap))}.c-block{padding:var(--card-pad,var(--sbs-card-pad));border-radius:var(--card-radius,var(--dst--default-radius));background:var(--card-bg,color-mix(in srgb,#fff 68%,${p.bg}));border:var(--card-bd,1px solid color-mix(in srgb,${p.ink} 13%,transparent))}.c-block:hover{transform:translateY(calc(-1 * var(--sbs-hover-lift)))}.dst-card--media-top .c-block__body,.dst-card--media-side .c-block__body{padding:var(--c-block__body-padding,var(--sbs-card-body-pad))}.dst-card--media-side{display:flex;align-items:stretch}.dst-card--media-side .c-block__media{flex:0 0 40%;margin:0}.dst-card--media-side.dst-card--flip{flex-direction:row-reverse}.dst-card--media-side .ph{height:100%;aspect-ratio:auto}.dst-card--media-background{aspect-ratio:var(--card-ar,4/3);min-height:0}.dst-card--media-background>.c-block__body{padding:var(--c-block__body-padding,var(--sbs-card-body-pad))}.ph img{object-fit:var(--media-fit,cover);object-position:var(--media-pos,50% 50%)}
.dst-list__grid{grid-template-columns:repeat(var(--dst-list__col,1),minmax(0,1fr));gap:var(--dst-list__row-gap,2.4rem)}.dst-list.text-center .dst-list__item{text-align:center;justify-content:center}.dst-list.text-center .dst-list__content{align-items:center}.dst-list.text-right .dst-list__item{text-align:right;justify-content:flex-end}.dst-list.text-right .dst-list__content{align-items:flex-end}.dst-list__content{min-width:0}
.site-header.header-centered .site-header__row,.site-header.logo-center .site-header__row{display:grid;grid-template-columns:1fr auto 1fr}.site-header.header-centered .site-header__logo{grid-column:2}.site-header.header-centered .nav-menu{grid-column:1;grid-row:1;margin-left:0}.site-header.header-centered .sbs-header-cta{grid-column:3;grid-row:1;justify-self:end}.site-header.header-minimal .site-header__row{min-height:calc(var(--dst--header-height) * .82)}#sbs-site .site-header.header-minimal .sbs-menu-toggle{display:block;margin-left:1.6rem;order:3}#sbs-site .site-header.header-minimal .nav-menu{display:none;position:absolute;left:0;right:0;top:100%;flex-direction:column;align-items:flex-start;gap:1.2rem;background:${p.bg};padding:2.2rem 2.4rem 2.8rem;border-bottom:1px solid color-mix(in srgb,${p.ink} 12%,transparent);box-shadow:0 18px 40px color-mix(in srgb,${p.ink} 10%,transparent)}#sbs-site .site-header.header-minimal.menu-open .nav-menu{display:flex}#sbs-site .site-header.header-minimal .sbs-header-cta{order:2;margin-left:auto}#sbs-site .site-header.header-minimal .site-header__row{display:flex;align-items:center;gap:2.4rem;justify-content:flex-end}#sbs-site .site-header.header-stacked .site-header__row{display:grid;grid-template-columns:1fr auto 1fr;grid-template-areas:"lead logo action" "nav nav nav";row-gap:1.3rem;align-items:center}#sbs-site .site-header.header-stacked .site-header__logo{grid-area:logo;justify-self:center}#sbs-site .site-header.header-stacked .sbs-menu-toggle{grid-area:lead;justify-self:start}#sbs-site .site-header.header-stacked .nav-menu{grid-area:nav;justify-content:center;margin:0;gap:2.2rem}#sbs-site .site-header.header-stacked .sbs-header-cta{grid-area:action;justify-self:end}#sbs-site .site-header.header-floating,#sbs-site .site-header.header-floating.is-stuck{background:transparent;border-bottom:0;box-shadow:none;padding:1.4rem 1.4rem 0}#sbs-site .site-header.header-floating .site-header__row{min-height:72px;padding-inline:2.6rem;border:1px solid color-mix(in srgb,${p.ink} 12%,transparent);border-radius:calc(var(--dst--default-radius) + 12px);background:color-mix(in srgb,${p.bg} 93%,transparent);box-shadow:0 16px 44px color-mix(in srgb,${p.ink} 13%,transparent)}#sbs-site .site-header.header-floating.is-stuck .site-header__row{background:color-mix(in srgb,${p.bg} 98%,transparent)}#sbs-site .site-header.header-floating .site-header__ann{border-radius:calc(var(--dst--default-radius) + 12px);margin-bottom:1rem}.sbs-logo-image{display:block;max-height:4.8rem;max-width:18rem;width:auto}.site-header.is-fixed{position:fixed;inset:0 0 auto}.site-header.hide-on-scroll{transition:transform .35s ease,background .25s}.site-header.is-hidden{transform:translateY(-110%)}
.sbs-footer.footer-compact .sbs-footer-statement{display:grid;grid-template-columns:1fr auto;align-items:end;max-width:none}.sbs-footer.footer-compact .footer__nl-sub{grid-column:1}.sbs-footer.footer-centered .sbs-footer-statement{text-align:center;align-items:center;margin-inline:auto}.sbs-footer.footer-centered .sbs-footer-statement>*{margin-inline:auto}.sbs-footer.footer-centered .footer__bottom{justify-content:center;text-align:center}.sbs-footer.footer-columns>.c-default{display:grid;grid-template-columns:minmax(0,.95fr) minmax(0,1.5fr);column-gap:clamp(4rem,7vw,10rem)}.sbs-footer.footer-columns .sbs-footer-statement{grid-column:1;grid-row:1;padding-bottom:0;max-width:none}.sbs-footer.footer-columns .sbs-footer-statement .footer__nl-head{font-size:clamp(3rem,3.7vw,5.4rem);max-width:16ch}.sbs-footer.footer-columns .footer__divider{display:none}.sbs-footer.footer-columns .footer__cols{grid-column:2;grid-row:1;grid-template-columns:1.2fr 1fr 1fr;gap:3rem}.sbs-footer.footer-columns .footer__bottom{grid-column:1 / -1;margin-top:clamp(5rem,8vw,9rem)}.sbs-footer.footer-minimal .sbs-footer-statement{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:2.4rem 3rem;max-width:none;padding-bottom:clamp(3rem,4.5vw,5.5rem)}.sbs-footer.footer-minimal .sbs-footer-statement .footer__nl-head{font-size:clamp(2.4rem,2.5vw,3.6rem);max-width:26ch;letter-spacing:-.02em}.sbs-footer.footer-minimal .sbs-footer-statement .footer__nl-sub,.sbs-footer.footer-minimal .sbs-footer-statement .c-heading__pre,.sbs-footer.footer-minimal .footer__col p,.sbs-footer.footer-minimal .footer__divider,.sbs-footer.footer-minimal .footer__wordmark{display:none}.sbs-footer-logo .sbs-logo-image{max-height:5.4rem}
.c-decoration .dst-deco{transform:scale(var(--sbs-decor-scale));transform-origin:center}.has-deco>.c-decoration{opacity:calc(.7 + ${exp.toFixed(2)} * .3)}
[data-motion-level="none"] [data-viewport]>*{opacity:1!important;transform:none!important;transition:none!important}[data-motion-level]:not([data-motion-level="none"]) [data-viewport-effect^="fade"]>*{transition-duration:var(--sbs-motion-duration);transform:translateY(var(--sbs-motion-distance))}[data-motion-level]:not([data-motion-level="none"]) [data-viewport-effect^="fade"].in-view>*{transform:none}.c-btn,.c-block,.ph{transition-duration:var(--sbs-motion-duration)}
@media(max-width:1024px){.ds-row{grid-template-columns:repeat(var(--cols-t,2),minmax(0,1fr));gap:var(--col-gap-t,var(--col-gap))}.ds-row>.ds-column{grid-column:span var(--column-span-t,1)}.is-heading-split:not(.keep-tablet-columns){grid-template-columns:1fr}.sbs-hero.hero-media-split-right .c-bg,.sbs-hero.hero-media-split-left .c-bg{inset:0!important;width:100%!important;opacity:.28}.sbs-hero.hero-media-split-left .dst-banner__container{align-items:flex-start}.sbs-hero.hero-media-split-left .c-overlay,.sbs-hero.hero-media-split-right .c-overlay{background:linear-gradient(180deg,${p.dark},color-mix(in srgb,${p.dark} 80%,transparent),${p.dark})}}
@media(max-width:680px){.c-custom{padding-inline:2rem}.ds-row{grid-template-columns:repeat(var(--cols-m,1),minmax(0,1fr));gap:var(--col-gap-m,var(--col-gap))}.ds-row>.ds-column{grid-column:span var(--column-span-m,1)!important;justify-self:stretch!important;width:100%;max-width:100%}.ds-row.layout-flex>.ds-column{flex-basis:100%}.c-heading.text-center-mobile{text-align:center}.c-heading.text-center-mobile>*:not(.c-heading__preamble){margin-inline:auto}.c-heading.text-right-mobile{text-align:right}.c-heading.text-right-mobile>*:not(.c-heading__preamble){margin-left:auto;margin-right:0}.c-heading.text-left-mobile{text-align:left}.c-heading.text-left-mobile>*:not(.c-heading__preamble){margin-left:0;margin-right:auto}.dst-button-group.justify-center-mobile{justify-content:center}.dst-button-group.justify-right-mobile{justify-content:flex-end}.dst-card--media-side,.dst-card--media-side.dst-card--flip{flex-direction:column}.dst-card--media-side .c-block__media{flex-basis:auto}.media-hide-mobile{display:none}.c-bg__media,.c-bg__layer{object-fit:var(--dst--bg-mobile-size,var(--dst--bg-desktop-size,cover))!important;object-position:var(--dst--bg-mobile-focal,var(--dst--bg-desktop-focal,50% 50%))!important}.ph img{object-fit:var(--media-fit-mobile,var(--media-fit,cover));object-position:var(--media-pos-mobile,var(--media-pos,50% 50%))}}
@media(prefers-reduced-motion:reduce){#sbs-site{--sbs-motion-duration:0s;--sbs-motion-distance:0px;--sbs-hover-lift:0px}}
/* dial:${motionLevel} */`;
};

/*
 * The rendered page's own behaviour.
 *
 * Everything that binds to a *module* is written as a function of a root node
 * and published as `window.__sbsBind(root)`, because the builder swaps one
 * module in place — see the v6 preview switcher — and the replacement needs its
 * slider, its tabs and its accordions to work without reloading the document.
 * Reloading would throw away the scroll position and replay every reveal
 * animation on the page, which is exactly what someone comparing two patterns
 * must not have happen.
 *
 * Binding is idempotent: each node is marked once, so calling it on the whole
 * document and then on a subtree never wires the same control twice.
 */
siteRuntime=function(){return `(function(){
var lastY=window.scrollY;
function siteHeader(){return document.querySelector('.site-header')}
function stuck(){var header=siteHeader();if(!header)return;header.classList.toggle('is-stuck',window.scrollY>14);if(header.classList.contains('hide-on-scroll')){var down=window.scrollY>lastY&&window.scrollY>120;header.classList.toggle('is-hidden',down);lastY=window.scrollY}}
window.addEventListener('scroll',stuck,{passive:true});
window.__sbsBindChrome=function(){
var header=siteHeader();
var dismiss=document.querySelector('.site-header__dismiss');if(dismiss&&once(dismiss))dismiss.addEventListener('click',function(){var bar=dismiss.closest('.site-header__ann');if(bar)bar.remove()});
var toggle=document.querySelector('.sbs-menu-toggle');if(toggle&&header&&once(toggle))toggle.addEventListener('click',function(){var open=header.classList.toggle('menu-open');toggle.setAttribute('aria-expanded',String(open))});
stuck();
};
var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches||document.querySelector('#sbs-site').dataset.motionLevel==='none';
var io=(reduce||!('IntersectionObserver' in window))?null:new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add('in-view');if(entry.target.dataset.viewportRepeat!=='true')io.unobserve(entry.target)}})},{threshold:.12,rootMargin:'0px 0px -6% 0px'});
/* Includes the root itself: a swapped-in module is very often the very node
   carrying [data-viewport], and querySelectorAll would look straight past it. */
function each(root,selector,fn){if(root.matches&&root.matches(selector))fn(root);root.querySelectorAll(selector).forEach(fn)}
function once(node){if(node.__sbsBound)return false;node.__sbsBound=true;return true}
window.__sbsBind=function(root,options){
var node=root||document,reveal=!!(options&&options.reveal);
each(node,'[data-viewport]',function(el){if(!once(el))return;if(reveal||!io)el.classList.add('in-view');else io.observe(el)});
each(node,'.nav-menu a,.scroll-down',function(a){if(once(a))a.addEventListener('click',function(){if(header)header.classList.remove('menu-open')})});
each(node,'[data-tabs]',function(tabs){if(!once(tabs))return;var buttons=tabs.querySelectorAll('[data-tab-index]'),panels=tabs.querySelectorAll('.sbs-tab-panel');buttons.forEach(function(btn){btn.addEventListener('click',function(){var n=Number(btn.dataset.tabIndex);buttons.forEach(function(b,i){b.classList.toggle('is-active',i===n);b.setAttribute('aria-selected',String(i===n))});panels.forEach(function(p,i){p.classList.toggle('is-active',i===n)})})})});
each(node,'[data-hacc]',function(group){if(!once(group))return;group.querySelectorAll('[data-hacc-button]').forEach(function(btn){btn.addEventListener('click',function(){var item=btn.closest('[data-hacc-item]');group.querySelectorAll('[data-hacc-item]').forEach(function(x){x.classList.toggle('is-active',x===item)})})})});
each(node,'[data-slider]',function(slider){if(!once(slider))return;var track=slider.querySelector('.dst-slider'),prev=slider.querySelector('.-prev'),next=slider.querySelector('.-next'),fill=slider.querySelector('.dst-slider__progress-fill');if(!track)return;function amount(){return Math.max(280,track.clientWidth*.72)}function update(){var max=track.scrollWidth-track.clientWidth,p=max?track.scrollLeft/max:0;if(fill)fill.style.transform='scaleX('+Math.max(.08,p)+')';if(prev)prev.setAttribute('aria-disabled',String(track.scrollLeft<4));if(next)next.setAttribute('aria-disabled',String(track.scrollLeft>max-4))}if(prev)prev.addEventListener('click',function(){track.scrollBy({left:-amount(),behavior:reduce?'auto':'smooth'})});if(next)next.addEventListener('click',function(){track.scrollBy({left:amount(),behavior:reduce?'auto':'smooth'})});track.addEventListener('scroll',update,{passive:true});update()});
each(node,'a[href^="#"]',function(a){if(!once(a))return;a.addEventListener('click',function(e){var id=a.getAttribute('href');if(id&&id.length>1){var target=document.querySelector(id);if(target){e.preventDefault();target.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'})}}})});
window.__sbsBindChrome();
};
window.__sbsBind(document);
})();
`};

buildSiteDocument=function(project){v2EnsureProject(project);project.sections.forEach(syncSectionNode);var b=project.brief,title=(b.projectName||'Untitled page')+' — '+String(b.goal||'').split(' ').slice(0,7).join(' '),families=[project.design.fontBody,project.design.fontDisplay].filter(function(x,i,a){return a.indexOf(x)===i}).map(function(f){return 'family='+encodeURIComponent(f).replace(/%20/g,'+')+':wght@400;500;600;700'}).join('&'),sections=project.sections.filter(function(s){return s.visible!==false}).map(function(s,i){return renderSection(s,i,project)}).join(''),motion=Number(project.design.motion)||0,level=motion<5?'none':motion<45?'subtle':motion<75?'active':'dynamic';return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="theme-color" content="'+escAttr(project.design.palette.bg)+'"><title>'+esc(title)+'</title><meta name="description" content="'+escAttr(b.goal||'')+'"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?'+families+'&display=swap" rel="stylesheet"><style>'+DST_SHARED_CSS+'\n'+siteCss(project)+'</style></head><body class="has-inview-a"><div id="top"></div><main class="ver active" id="sbs-site" data-motion-level="'+level+'" data-density="'+project.design.density+'" data-expression="'+project.design.expressiveness+'">'+renderHeader(project)+sections+renderFooter(project)+'</main><script>'+siteRuntime()+'<\/script></body></html>'};

function v2AuditDocument(doc){
  if(!doc||!doc.documentElement)return {score:0,issues:['Preview document was not available'],metrics:{}};var issues=[],root=doc.documentElement,client=root.clientWidth,overflow=Math.max(0,root.scrollWidth-client);if(overflow>3)issues.push('Horizontal overflow: '+Math.round(overflow)+'px');var centered=0,centerFailures=0;doc.querySelectorAll('.c-heading.text-center,.c-heading.-center').forEach(function(h){var hw=h.clientWidth;Array.from(h.children).filter(function(el){return !el.classList.contains('c-heading__preamble')&&el.offsetWidth>0}).forEach(function(el){var ew=el.offsetWidth;if(ew<hw-4){centered++;var center=el.offsetLeft+ew/2;if(Math.abs(center-hw/2)>4)centerFailures++}})});if(centerFailures)issues.push(centerFailures+' centered, width-constrained heading elements are off-center');var bgCount=0,bgFailures=0;doc.querySelectorAll('.c-bg__media').forEach(function(img){var parent=img.closest('.c-bg__item')||img.parentElement,ir=img.getBoundingClientRect(),pr=parent&&parent.getBoundingClientRect();if(pr&&pr.width>0&&pr.height>0){bgCount++;if(ir.width+2<pr.width||ir.height+2<pr.height)bgFailures++}});if(bgFailures)issues.push(bgFailures+' background media layers do not fill their slots');var undefinedText=(doc.body&&doc.body.innerText||'').match(/\b(undefined|NaN|\[object Object\])\b/g)||[];if(undefinedText.length)issues.push('Rendered placeholder values found: '+Array.from(new Set(undefinedText)).join(', '));var h1=doc.querySelectorAll('h1').length;if(h1>1)issues.push('Multiple H1 elements: '+h1);
  // Measured on the finished page rather than inferred from the model, because
  // every way this fails — a scrim that did not render, a band that painted its
  // own colour, an inverted class on a light section — is invisible upstream.
  var legibility=v9LegibilityAudit(doc);
  if(legibility.failures.length)issues.push(legibility.failures.length+' section'+(legibility.failures.length===1?'':'s')+' with text too close in colour to the band behind it');
  return {score:Math.max(0,100-issues.length*18),issues:issues,legibility:legibility,metrics:{overflowPx:overflow,centeredElementsChecked:centered,centerFailures:centerFailures,backgroundLayersChecked:bgCount,backgroundFailures:bgFailures,h1Count:h1,sectionsChecked:legibility.checked,contrastFailures:legibility.failures.length}}}
/* ---------------------------------------------------------------- *
 * Rendered legibility
 *
 * Everything else in this file reasons about colour from the model: this
 * section's tone, that overlay's alpha, the palette's ink. That reasoning is
 * where the failures come from — a card whose scrim did not render, a band whose
 * pattern painted its own background, a heading inheriting an inverted class
 * from a section that turned out light. None of it is visible to a check that
 * looks at the same model the mistake was made in.
 *
 * So this measures the finished page instead. It reads the computed colour of
 * real text against the first opaque thing behind it and reports what a person
 * would actually be squinting at. It is the only check in the builder that can
 * catch "bright background, bright text" whatever caused it.
 * ---------------------------------------------------------------- */

/** `rgb()`, `rgba()` and `color(srgb …)` — the three shapes getComputedStyle returns. */
function v9ParseColor(value){
  var raw=String(value||''),numbers=(raw.match(/[\d.]+(?:e-?\d+)?/g)||[]).map(Number);
  if(numbers.length<3)return null;
  var alpha=numbers.length>3?numbers[3]:1;
  // `color(srgb 0.9 0.9 0.9)` is 0–1 per channel; everything else is 0–255.
  var scale=raw.indexOf('color(')===0?255:1;
  return {rgb:numbers.slice(0,3).map(function(n){return n*scale}),alpha:alpha};
}
function v9Luminance(rgb){
  var c=rgb.map(function(v){var n=Math.max(0,Math.min(255,v))/255;return n<=0.03928?n/12.92:Math.pow((n+0.055)/1.055,2.4)});
  return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];
}
function v9Ratio(a,b){
  var la=v9Luminance(a),lb=v9Luminance(b);
  return (Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05);
}

/**
 * The first thing behind an element that is actually opaque.
 *
 * Walking up until something paints is the only honest answer: a heading has no
 * background of its own, and the band two ancestors above it is what the reader
 * sees. Anything below full opacity is skipped rather than blended, because a
 * translucent layer over an unknown ground is a guess either way and this check
 * should only ever report what it can prove.
 */
function v9GroundBehind(doc,view,el){
  var node=el;
  while(node&&node!==doc.documentElement){
    /*
     * A picture is not a colour, and a contrast number against one is noise.
     *
     * The scrim under a media card is a *sibling* of the copy, not an ancestor,
     * so walking for a background colour sails straight past it and reports the
     * page paper as the ground — which is how a perfectly readable white
     * headline on a photograph measures 1.1:1 and gets flagged. Anything with a
     * picture layer behind it ends the walk with "not measurable" instead.
     */
    if(node.className&&String(node.className).indexOf('dst-card--media-background')!==-1)return null;
    if(node.querySelector&&node.querySelector(':scope > .c-bg,:scope > .c-block__scrim,:scope > .c-overlay'))return null;
    if(/url\(/i.test(view.getComputedStyle(node).backgroundImage||''))return null;
    var parsed=v9ParseColor(view.getComputedStyle(node).backgroundColor);
    if(parsed&&parsed.alpha>0.85)return parsed.rgb;
    node=node.parentElement;
  }
  var body=v9ParseColor(view.getComputedStyle(doc.body).backgroundColor);
  return body?body.rgb:[255,255,255];
}

var V9_TEXT_SELECTOR='h1,h2,h3,h4,.c-heading__sub,.c-heading__pre,.c-block__title,.c-block__description,.dst-list__item,p,li,blockquote';

/**
 * Every section's worst readable line, measured.
 *
 * Text sitting over a photograph is excluded, not because it cannot fail but
 * because the ground under it is a picture: a contrast number against whatever
 * pixel happens to be behind the first letter would be noise, and the overlay
 * controls are the answer there. Everything on a flat band is fair game.
 */
function v9LegibilityAudit(doc){
  if(!doc||!doc.defaultView||!doc.body)return {sections:[],failures:[],checked:0};
  var view=doc.defaultView,sections=[];
  Array.prototype.forEach.call(doc.querySelectorAll('#sbs-site > section'),function(section){
    if(section.querySelector('.c-bg img,.c-bg video,.c-bg picture'))return;
    var worst=null,checked=0;
    Array.prototype.forEach.call(section.querySelectorAll(V9_TEXT_SELECTOR),function(el){
      if(!String(el.textContent||'').trim())return;
      var box=el.getBoundingClientRect();
      if(box.height<6||box.width<6)return;
      var colour=v9ParseColor(view.getComputedStyle(el).color);
      if(!colour||colour.alpha<0.5)return;
      var ground=v9GroundBehind(doc,view,el);
      // Null means "this text is over a picture". The overlay controls are the
      // answer there, and this check has nothing honest to say about it.
      if(!ground)return;
      checked+=1;
      var ratio=v9Ratio(colour.rgb,ground);
      if(!worst||ratio<worst.ratio){
        worst={
          ratio:Math.round(ratio*100)/100,
          sample:String(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,48),
          // Headings are large text, which WCAG lets sit at 3:1. Holding a 96px
          // display face to the body threshold reports failures nobody can see.
          target:Number.parseFloat(view.getComputedStyle(el).fontSize)>=24?3:4.5
        };
      }
    });
    if(worst&&checked)sections.push({id:section.id,ratio:worst.ratio,target:worst.target,sample:worst.sample,pass:worst.ratio>=worst.target});
  });
  return {sections:sections,failures:sections.filter(function(entry){return !entry.pass}),checked:sections.length};
}

function v2PreviewScrollPosition(frame){try{var view=frame.contentWindow;return view?{x:view.scrollX||0,y:view.scrollY||0}:null}catch(e){return null}}
function v2RestorePreviewScroll(frame,position){if(!position)return;try{var view=frame.contentWindow,doc=frame.contentDocument;if(!view||!doc)return;var root=doc.documentElement,body=doc.body,maxY=Math.max(0,Math.max(root.scrollHeight,body?body.scrollHeight:0)-view.innerHeight);view.scrollTo(position.x,Math.min(position.y,maxY))}catch(e){}}
renderPreview=function(){try{var frame=byId('sitePreview'),scrollPosition=v2PreviewScrollPosition(frame);frame.onload=function(){var restore=function(){v2RestorePreviewScroll(frame,scrollPosition)};restore();setTimeout(restore,120);setTimeout(function(){try{var audit=v2AuditDocument(frame.contentDocument);var changed=JSON.stringify(audit)!==JSON.stringify(state.previewAudit);state.previewAudit=audit;if(changed&&state.currentStep===4)renderEditor()}catch(e){console.warn('Preview audit failed',e)}},80)};frame.srcdoc=buildSiteDocument(state.project)}catch(e){console.error(e);byId('sitePreview').srcdoc='<pre style="padding:20px;font:14px monospace">Preview error: '+esc(e.message)+'</pre>'}};

function v2ClientMeta(project){var p=project.design.palette,b=project.brief;return {name:b.clientName||project.client,slug:slugify(b.clientName||project.client),sourceUrl:'',primaryObjective:b.goal,primaryKeyword:String(b.keywords||'').split(',')[0].trim(),brandPaletteCaptured:[{role:'body canvas',hex:p.bg},{role:'ink and headings',hex:p.ink},{role:'brand accent',hex:p.accent},{role:'supporting surface',hex:p.soft},{role:'inverted ground',hex:p.dark}]}}
/** The nine dials as exported, so an artifact records the design it resolved from. */
function v5DialSnapshot(design){var out={};DIAL_KEYS.forEach(function(key){var value=Number(design&&design[key]);if(Number.isFinite(value))out[key]=value});return out}

/**
 * Every artifact names the concept it came from.
 *
 * Three concepts produce three sets of artifacts with the same client and the
 * same schema. Without this block a V2 page JSON and a V1 page JSON are
 * indistinguishable, and importing the wrong one is a silent failure.
 */
function v5ConceptMeta(project){
  var concept=getActiveConcept(project)||{};
  var style=concept.style||{};
  return {
    conceptId:concept.id||'v1',
    slot:concept.slot||'V1',
    conceptName:concept.name||'',
    variantType:concept.variantType||'core',
    revision:Number(concept.revision)||1,
    style:{
      familyId:style.familyId||'',
      styleId:style.styleId||'',
      styleVersion:style.styleVersion||'',
      variantType:style.variantType||'core',
      archetypeKey:project.design.archetype||''
    },
    designDials:v5DialSnapshot(project.design)
  };
}

function v2BaseEnvelope(project,name,type){var arch=DATA.archetypes[project.design.archetype]||{};var meta=v5ConceptMeta(project);return {$schemaComment:'DST '+type+' export generated by the SBS Page Builder.',$provenanceNote:'The page, navigation and footer are separate importer artifacts generated from one concept workspace.',schemaVersion:'dst-concept-export/1.0',artifactVersion:'sbs-builder-artifact/3.0',catalogVersion:DATA.skill.catalogVersion||'4.0-three-source (merged)',generatedFrom:'dst-concept-to-json',artifactType:type,client:v2ClientMeta(project),concept:Object.assign({id:slugify(project.id+'-'+meta.conceptId+'-'+type),name:name},meta,{archetype:project.design.archetype+' — '+(DATA.archetypes[project.design.archetype]&&DATA.archetypes[project.design.archetype].name||'Custom'),polarity:arch.polarity||'light',isActivePreview:true,theme:buildTheme(project)}),__status:{builder:'SBS DST Page Builder '+SBS_BUILDER_VERSION,skill:DATA.skill.name,patternsAvailable:DATA.skill.patternCount,generatedAt:new Date().toISOString()}}}
function v2NavigationChildren(project){var h=project.header,cta=h.cta&&h.cta.text?[{id:'site-header-cta-group',component:'ds-blocks/button-group',usage:'header-cta-group',confidence:'confirmed',attributes:{justifyContent:'right',justifyContentMobile:'center',alignment:'horizontal',gapBetween:10},children:[{id:'site-header-cta',component:'ds-blocks/c-btn',usage:'header-cta',confidence:'confirmed',attributes:{text:h.cta.text,link:{url:normalizeLink(h.cta.link),opensInNewTab:false,title:''},btnType:'primary',btnSize:'small',hasIcon:false,iconPosition:'row-reverse'},children:[]}]}]:[];var mainContent={id:'site-header-main-content',component:'ds-blocks/dst-navigation-content',usage:'main-navigation-content',confidence:'confirmed',attributes:{navigationArea:'main',isInitialized:true},children:[{id:'site-header-logo',component:'ds-blocks/dst-navigation-logo',usage:'site-logo',confidence:'confirmed',attributes:{inlineSvgLogo:false,logoWidth:'',logoHeight:''},content:{text:h.logoText,mark:h.logoMark,url:h.logoUrl||''},children:[]},{id:'site-header-menu',component:'ds-blocks/dst-navigation-menu',usage:'primary-menu',confidence:'confirmed',attributes:{menuValue:'primary-menu',isBurgerMenu:false},menuItems:h.nav.map(function(x){return {label:x[0],url:normalizeLink(x[1])}}),children:[]}].concat(cta)};var mobileContent={id:'site-header-mobile-content',component:'ds-blocks/dst-navigation-content',usage:'mobile-navigation-content',confidence:'confirmed',attributes:{navigationArea:'mobile',isInitialized:true},children:[{id:'site-header-mobile-logo',component:'ds-blocks/dst-navigation-logo',usage:'mobile-site-logo',confidence:'confirmed',attributes:{inlineSvgLogo:false,logoWidth:'',logoHeight:''},content:{text:h.logoText,mark:h.logoMark,url:h.logoUrl||''},children:[]},{id:'site-header-mobile-menu',component:'ds-blocks/dst-navigation-menu',usage:'mobile-primary-menu',confidence:'confirmed',attributes:{menuValue:'primary-menu',isBurgerMenu:true},menuItems:h.nav.map(function(x){return {label:x[0],url:normalizeLink(x[1])}}),children:[]}].concat(cta)};var children=[];if(h.announcement)children.push({id:'site-header-announcement',component:'ds-blocks/dst-navigation-announcement',usage:'announcement',confidence:'confirmed',attributes:{},content:{text:h.announcement,dismissible:!!h.announcementDismissible},children:[]});children.push({id:'site-header-main',component:'ds-blocks/dst-navigation-main',usage:'main-navigation',confidence:'confirmed',attributes:{},children:[mainContent]});children.push({id:'site-header-mobile',component:'ds-blocks/dst-navigation-mobile',usage:'mobile-navigation',confidence:'confirmed',attributes:{menuStyle:mobileMenuStyle(h.mobileMenu)},children:[mobileContent]});return children}
headerExport=function(project){v2EnsureProject(project);var h=project.header;return {id:'site-header',component:'ds-blocks/dst-navigation',usage:'header',role:'header',confidence:'confirmed',importerShorthand:true,note:'Global DST navigation export. The nav shorthand carries authored content; children preserve the registered navigation block composition.',layout:{container:h.container||'default',background:{kind:'slot',slot:'body-bg'}},attributes:{dsContainer:'',dsContainerCustom:'',dsContainerSideGap:true,dsContainerAlign:'center',displayType:h.position||'sticky',hideOnScrollDown:!!h.hideOnScrollDown,innerContainerWidth:'container',innerContainerWidthCustom:'',useAnnouncementBar:!!h.announcement,announcementBarDismissible:!!h.announcementDismissible,useCustomHeaderHeight:false,disableHeaderHeightFallback:false,frostedGlass:!!h.frostedGlass,mobileMenuStyle:mobileMenuStyle(h.mobileMenu),backgroundColor:h.bgColor||'var(--dst--body-bg)',backgroundOpacity:Number(h.bgOpacity),textColor:h.textColor||'',linkHoverColor:h.linkHoverColor||'',borderColor:h.borderColor||''},linkTypography:{ref:'theme.elements.navigation.mainLink'},nav:{variant:headerVariant(h.variant),mobileMenu:mobileMenuStyle(h.mobileMenu),logo:{text:h.logoText,mark:h.logoMark,url:h.logoUrl||'',alt:h.logoAlt||h.logoText||'',description:h.logoDescription||'',hideText:!!cleanText(h.logoUrl)},menu:h.nav.map(function(x){return {label:x[0],url:normalizeLink(x[1])}}),cta:{label:h.cta.text,url:normalizeLink(h.cta.link),btnType:'primary'}},children:v2NavigationChildren(project)}};
footerExport=function(project){v2EnsureProject(project);var f=project.footer;return {id:'site-footer',component:'ds-blocks/dst-wrapper',usage:'footer',role:'footer',confidence:'confirmed',inverted:true,importerShorthand:true,note:'Global three-band DST footer template-part export.',layout:{padding:{top:'default',bottom:'default'},container:'full',background:{kind:'slot',slot:'body-bg-alt'},fullWidthWrapper:true},attributes:{fullWidthWrapper:true,backgroundColor:'var(--dst--body-bg-alt)'},footer:{variant:'footer-'+footerVariant(f.variant),brand:{text:f.logoText,mark:f.logoMark,url:f.logoUrl||'',alt:f.logoAlt||f.logoText||'',description:f.logoDescription||'',hideText:!!cleanText(f.logoUrl),wordmark:f.wordmark},top:{heading:f.statement,subheading:f.description,cta:{label:f.cta.text,url:normalizeLink(f.cta.link),btnType:'primary-inverted'}},columns:[{kind:'brand',logo:true,socialsTitle:'Connect',body:project.brief.offer}].concat(f.columns.map(function(c){return {kind:'menu',heading:c.title,menuLocation:c.menuLocation||'footer-menu',links:c.links.map(function(x){return {label:x[0],url:normalizeLink(x[1])}})}})),columnWidths:['1.6fr'].concat(f.columns.map(function(){return '1fr'})),columnsTablet:2,columnsMobile:1,bottom:{copyright:f.legal,privacyMenu:{menuLocation:'privacy-menu',links:f.privacyLinks.map(function(x){return {label:x[0],url:normalizeLink(x[1])}})}},headingTypography:{tag:'div',preset:'h4-style',fontFamily:'var(--dst--font-primary)',textTransform:'uppercase',letterSpacing:'.08em',fontSize:'1.4rem',fontWeight:700},backgroundColor:f.bgColor||'var(--dst--body-bg-alt)',textColor:f.textColor||'var(--dst--base-text-color-alt)',headingColor:f.headingColor||'var(--dst--base-heading-color-alt)',linkColor:f.linkColor||'var(--dst--base-link-color-alt)',iconColor:f.accentColor||'var(--dst--primary-color2)',legalColor:f.textColor||'var(--dst--base-text-color-alt)',dividerColor:'rgba(255,255,255,.18)'},children:[{id:'footer-socials',component:'ds-blocks/dst-social-networks',usage:'socials',confidence:'confirmed',attributes:{socialSource:'custom',layoutDirection:'horizontal',alignDesktop:'flex-start',alignMobile:'flex-start',socialNetworks:f.socials.map(function(s,i){return {id:s.id||s.network||'social-'+i,network:s.network||'link',label:s.label||s.network||'Social',url:normalizeLink(s.url||'#')}}),showCaptions:false,socialIconGap:'1.2rem'}}],decorations:[{kind:'motif',motif:'tick-scale',color:'secondary-color1',position:'right',opacity:.1,scale:.9,rationale:'A measured edge rail reinforces the global footer without obscuring content.'}]}}
buildTheme=function(project){v2EnsureProject(project);var d=project.design,p=d.palette,den=clamp(Number(d.density)||0,0,100)/100,exp=clamp(Number(d.expressiveness)||0,0,100)/100,mot=clamp(Number(d.motion)||0,0,100)/100,darkGround=relativeLum(p.bg)<.42,inverseTitle=darkGround?(relativeLum(p.dark)<.3?p.dark:'#080A0E'):'#FFFFFF',altGround=darkGround?'#F7F7F3':p.dark;return {theme:'builder-'+d.archetype.toLowerCase(),designDials:{density:d.density,expressiveness:d.expressiveness,motion:d.motion},colors:{'primary-color1':p.ink,'primary-color2':p.accent,'primary-color3':p.dark,'secondary-color1':inverseTitle,'secondary-color2':p.bg,'secondary-color3':p.soft,'secondary-color4':p.accent,'secondary-color5':p.soft,'secondary-color6':p.accent,'secondary-color7':darkGround?altGround:'#FFFFFF','secondary-color8':p.accent,'body-bg':'secondary-color2','body-bg-alt':darkGround?'secondary-color7':'primary-color3','base-text-color':'primary-color1','base-text-color-alt':'secondary-color1','base-heading-color':'primary-color1','base-heading-color-alt':'secondary-color1','base-link-color':'primary-color2','base-link-color-alt':'secondary-color1','border-color':'secondary-color5','border-color-alt':'rgba(255,255,255,0.28)','pretitle-color':'primary-color2','pretitle-color-alt':'secondary-color1','subtitle-color':'primary-color1','subtitle-color-alt':'secondary-color1','backtitle-color-alt':'rgba(255,255,255,0.08)','counter-color':'primary-color2','counter-color-alt':'secondary-color1'},layout:{'default-radius':d.radius,'default-radius-mobile':d.radius,'default-container-width':'1440px','wide-container-width':'1780px','alt-container-width':'1060px','desktop-vertical-gap':(12.6-6.2*den).toFixed(2)+'vmin','mobile-vertical-gap':Math.round(64-20*den)+'px','desktop-gutter':'2.4rem','header-height':Math.round(96-24*den)+'px','header-height-mobile':'70px','card-padding':(4.6-2.3*den).toFixed(2)+'rem','grid-gap':(3.6-2*den).toFixed(2)+'rem'},backgrounds:{'grad-1':'linear-gradient(135deg, '+altGround+', '+p.ink+')','grad-2':'linear-gradient(135deg, '+p.accent+', '+altGround+')'},typography:{fonts:{primary:{family:d.fontBody,google:true,fallback:'system-ui, sans-serif'},secondary:{family:d.fontDisplay,google:true,fallback:'Georgia, serif'}},headings:{h1:{min:'42px',max:(7.6+5.2*exp).toFixed(1)+'rem',ff:'secondary',fw:600,lh:'0.98',ls:'-0.035em',tt:'none',mb:'0.35em'},h2:{min:'32px',max:(5.2+2.8*exp).toFixed(1)+'rem',ff:'secondary',fw:600,lh:'1.02',ls:'-0.03em',tt:'none',mb:'0.4em'},h3:{min:'22px',max:'3.6rem',ff:'secondary',fw:600,lh:'1.12',tt:'none',mb:'0.5em'},h4:{min:'18px',max:'2.4rem',ff:'primary',fw:600,lh:'1.25',tt:'none',mb:'0.5em'},pretitle:{min:'11px',max:'1.4rem',ff:'primary',fw:600,lh:'1.2',ls:'0.18em',tt:'uppercase',mb:'0.9em',color:'pretitle-color'},subtitle:{min:'18px',max:'2.2rem',ff:'primary',fw:400,lh:'1.55',tt:'none',color:'base-text-color'},backtitle:{min:'60px',max:(10+6*exp).toFixed(1)+'rem',ff:'secondary',fw:600,tt:'none',color:'secondary-color2'}},body:{base:{ff:'primary',fw:400,lh:(1.72-.16*den).toFixed(2),ls:'0'},scale:{sm:{min:'14px',max:'1.5rem'},base:{min:'16px',max:'1.8rem'},lg:{min:'19px',max:'2.3rem'}},presets:[]}},elements:{navigation:{mainLink:{ff:'primary',fs:'1.6rem',fw:600,tt:'none',ls:'0',color:'primary-color1',colorHover:'primary-color2'},mobileLink:{ff:'primary',fs:'2rem',fw:600,color:'primary-color1'}},buttons:{shared:{ff:'primary',fs:'1.5rem',fw:650,tt:'none',ls:'0',radius:d.radius,padding:'1.55rem 2.7rem',gap:'.9em',iconSize:'1.4rem'},primary:{c:'secondary-color1',bg:'primary-color2',bdc:'primary-color2',bdw:'0',cHover:'secondary-color1',bgHover:'primary-color3',bdcHover:'primary-color3'},primaryInverted:{c:'primary-color1',bg:'secondary-color1',bdc:'secondary-color1',bdw:'0',cHover:'secondary-color1',bgHover:'primary-color2',bdcHover:'primary-color2'},secondary:{c:'primary-color1',bg:'transparent',bdc:'primary-color1',bdw:'1px',cHover:'secondary-color1',bgHover:'primary-color1',bdcHover:'primary-color1'},secondaryInverted:{c:'secondary-color1',bg:'transparent',bdc:'secondary-color1',bdw:'1px',cHover:'primary-color1',bgHover:'secondary-color1',bdcHover:'secondary-color1'},link:{c:'primary-color1',cHover:'primary-color2',iconColor:'primary-color1'},icon:{enabled:true,linkEnabled:true,icon:'lib-icon-arrow2',position:'row-reverse'}},forms:{},testimonials:{},socials:{},sliders:{},wysiwyg:{}},motion:{level:mot<.05?'none':mot<.45?'subtle':mot<.75?'active':'dynamic',duration:mot<.05?'0s':(.22+.52*mot).toFixed(2)+'s',distance:Math.round(8+54*mot)+'px',prefersReducedMotionFallback:true,customEffects:{}}}}
function buildPageExport(project){v2EnsureProject(project);project.sections.forEach(syncSectionNode);var out=v2BaseEnvelope(project,(project.brief.projectName||'Untitled')+' — Page','page');out.concept.page={title:project.brief.projectName,slug:slugify(project.brief.projectName),flow:{id:project.flowId,name:(flowById(project.flowId,project)||{}).name||'Custom',rationale:(flowById(project.flowId,project)||{}).tagline||'Custom sequence'},sections:project.sections.filter(function(s){return s.visible!==false}).map(normalizeExportSection)};out.__status.validation=validateProject();return out}
function buildNavigationExport(project){var out=v2BaseEnvelope(project,(project.brief.clientName||project.brief.projectName)+' — Navigation','navigation');out.concept.global={navigation:headerExport(project)};out.concept.templateParts={navigation:out.concept.global.navigation};return out}
function buildFooterExport(project){var out=v2BaseEnvelope(project,(project.brief.clientName||project.brief.projectName)+' — Footer','footer');out.concept.global={footer:footerExport(project)};out.concept.templateParts={footer:out.concept.global.footer};return out}
function buildGlobalsExport(project){var out=v2BaseEnvelope(project,(project.brief.clientName||project.brief.projectName)+' — Global parts','globals');out.concept.global={navigation:headerExport(project),footer:footerExport(project)};out.concept.templateParts=out.concept.global;return out}
buildExport=function(project){var out=v2BaseEnvelope(project,(project.brief.projectName||'Untitled')+' — Complete project','complete-project');out.concept.global={navigation:headerExport(project),footer:footerExport(project)};out.concept.page=buildPageExport(project).concept.page;out.concept.templateParts=out.concept.global;out.__status.validation=validateProject();return out};

validateProject=function(){v2EnsureProject(state.project);var base=legacyValidateProjectV1(),checks=base.checks.slice(),globalNodes=[headerExport(state.project),footerExport(state.project)],globalComps=[];globalNodes.forEach(function(n){walkNode(n,function(x){globalComps.push(x.component)})});var unknownGlobals=Array.from(new Set(globalComps.filter(function(c){return c!=='global-footer'&&!DATA.registry[c]})));checks.push({status:cleanText(state.project.header.logoText)?'pass':'fail',title:'Navigation identity is editable',detail:cleanText(state.project.header.logoText)?'Logo text, mark, menu and CTA are connected to the live preview.':'Add navigation logo text.',code:'GLOBAL-NAV'});checks.push({status:cleanText(state.project.footer.statement)?'pass':'warn',title:'Footer global is populated',detail:cleanText(state.project.footer.statement)?'Footer statement, columns, legal line and CTA are ready.':'Add a footer closing statement.',code:'GLOBAL-FOOTER'});checks.push({status:unknownGlobals.length?'fail':'pass',title:'Global exports use registered components',detail:unknownGlobals.length?unknownGlobals.join(', '):globalComps.filter(function(x){return x&&x.indexOf('ds-blocks/')===0}).length+' registered global block nodes checked.',code:'GLOBAL-REGISTRY'});var audit=state.previewAudit;if(audit)checks.push({status:audit.issues.length?'warn':'pass',title:'Rendered preview geometry',detail:audit.issues.length?audit.issues.join(' · '):'No horizontal overflow, centered-width drift or background-fill failures detected.',code:'RENDER'});
  /*
   * Two checks, because they fail for different reasons and have different
   * answers. The palette one is about the five colours themselves and is fixed
   * by changing a colour; the rendered one is about what a specific band did
   * with them and is fixed by changing that section's tone or overlay.
   */
  var legibility=audit&&audit.legibility;
  if(legibility)checks.push({
    status:legibility.failures.length?'fail':'pass',
    title:'Every band can be read',
    detail:legibility.failures.length
      ?legibility.failures.map(function(entry){return (familyLabels[String(entry.id).replace(/^section-/,'').replace(/-[^-]+-[^-]+$/,'')]||entry.id)+' — '+entry.ratio+':1 on “'+entry.sample+'”'}).join(' · ')
      :legibility.checked+' band'+(legibility.checked===1?'':'s')+' measured on the rendered page; every one clears its contrast target.',
    code:'RENDER-CONTRAST'
  });var comps=Array.from(new Set(base.comps.concat(globalComps))),score=Math.round(checks.reduce(function(n,c){return n+(c.status==='pass'?1:c.status==='warn'?.55:0)},0)/checks.length*100);return {checks:checks,comps:comps,images:base.images,score:score,warnings:checks.filter(function(c){return c.status==='warn'}).length,failures:checks.filter(function(c){return c.status==='fail'}).length}}
renderReview=function(){var v=validateProject(),audit=state.previewAudit;return pageHead('05 · Review & export','Page and global parts, ready to import.','Navigation and footer are global template-part exports. The page JSON contains page modules only. The standalone HTML combines all three for visual review.',v.failures?v.failures+' blockers':v.warnings?v.warnings+' notes':'Ready')+v5ConceptsPanel()+panel('Concept health','<div class="review-grid"><div class="score-card"><b>'+v.score+'</b><span>Readiness score</span></div><div class="score-card"><b>'+state.project.sections.length+'</b><span>Page modules</span></div><div class="score-card"><b>'+v.comps.length+'</b><span>Component types</span></div></div>')+panel('Preflight checks','<div class="check-list">'+v.checks.map(function(c){return '<div class="check '+c.status+'"><span class="check-ico">'+(c.status==='pass'?'✓':c.status==='warn'?'!':'×')+'</span><div><b>'+esc(c.title)+'</b><p>'+esc(c.detail)+'</p></div><code>'+c.code+'</code></div>'}).join('')+'</div>','Skill + render aware')+panel('Importer downloads','<div class="export-card"><div class="export-icon"><svg viewBox="0 0 24 24"><path d="M4 5h16v4H4zM4 12h16v7H4z"/></svg></div><div><b>Navigation JSON</b><p>Global DST navigation, authored logo, menu, CTA, responsive composition and registered child block tree.</p></div><button class="export-btn" data-export="navigation">Download</button></div><div class="export-card"><div class="export-icon"><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4zM4 15h16"/></svg></div><div><b>Footer JSON</b><p>Global footer template part with closing statement, menus, socials, legal row and design metadata.</p></div><button class="export-btn" data-export="footer">Download</button></div><div class="export-card"><div class="export-icon"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M10 13h5M10 17h5"/></svg></div><div><b>Page JSON</b><p>Page modules only: theme, flow, SBS pattern provenance, normalized DST trees, media, effects and decorations.</p></div><button class="export-btn" data-export="page">Download</button></div><div class="export-card"><div class="export-icon"><svg viewBox="0 0 24 24"><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/></svg></div><div><b>Standalone website HTML</b><p>Navigation + page + footer rendered together with responsive interactions and reduced-motion support.</p></div><button class="export-btn" data-export="html">Download</button></div><details class="advanced-export"><summary>Advanced handoff</summary><div class="export-card"><div class="export-icon"><svg viewBox="0 0 24 24"><path d="M4 6h16v12H4zM8 10h8M8 14h5"/></svg></div><div><b>Complete project bundle</b><p>ZIP containing navigation.json, footer.json, page.json, and website.html for one-click handoff.</p></div><button class="export-btn" data-export="bundle">Download</button></div></details>')+renderEditorNav()}
/**
 * The export filename carries the concept.
 *
 * Three concepts export the same four artifact names from the same client. A
 * strategist with `redmoon-page.json` twice in a downloads folder has no way to
 * tell which proposal they are about to import.
 */
function v5ExportSlug(){
  var base=slugify(state.project.brief.projectName||state.project.brief.clientName);
  var concept=getActiveConcept(state.project);
  if(!concept||listGeneratedConcepts(state.project).length<2)return base;
  return base+'-'+String(concept.slot||'v1').toLowerCase();
}

/**
 * Builds one concept's four artifacts without leaving that concept active.
 *
 * Exporting is a read, so activating each concept in turn is safe — but the
 * strategist must be looking at the same concept afterwards as before, whatever
 * happens in between.
 */
function v5WithConcept(conceptId,build){
  var restore=getActiveConceptId(state.project);
  var settle=function(){
    bindProject(state.project);
    v2EnsureProject(state.project);
    v3EnsureDesign(state.project);
    state.project.sections.forEach(syncSectionNode);
  };
  try{
    setActiveConcept(state.project,conceptId);
    settle();
    return build(getActiveConcept(state.project));
  }finally{
    setActiveConcept(state.project,restore);
    settle();
  }
}

/**
 * True when a concept still holds exactly the workspace it was generated as.
 *
 * The distinction the flow step needs: a concept nobody has touched yet should
 * follow the chosen structure so the three proposals stay comparable, and a
 * concept somebody has worked on should not be rebuilt underneath them.
 */
function v5ConceptIsUntouched(concept){
  if(!concept||!concept.generatedFrom)return false;
  return JSON.stringify(snapshotWorkspace(concept))===JSON.stringify(concept.generatedFrom);
}

/**
 * Applying a page flow, across concepts.
 *
 * The first flow chosen for a project lands on every concept, because three
 * proposals built on three different structures are not a comparison. Once a
 * concept has been edited it keeps its own flow, and a later flow change reaches
 * only the concept being edited — a structure change is never propagated over
 * somebody's work.
 */
applyFlow=function(id){
  var flow=flowById(id);
  if(!flow)return;
  var followers=listGeneratedConcepts(state.project)
    .filter(function(concept){return concept.id!==getActiveConceptId(state.project)&&v5ConceptIsUntouched(concept)})
    .map(function(concept){return concept.id});
  mutate(function(){
    applyFlowToActiveConcept(flow);
    followers.forEach(function(conceptId){
      v5WithConcept(conceptId,function(concept){
        applyFlowToActiveConcept(flow);
        // The concept has not been worked on, so this is still its generated
        // state: record it as such, or "reset to generated" would undo the flow.
        concept.generatedFrom=snapshotWorkspace(concept);
      });
    });
    v5SettleActiveConcept();
  },{message:followers.length
    ? 'Applied '+flow.id+' · '+flow.name+' to all '+(followers.length+1)+' concepts'
    : 'Applied '+flow.id+' · '+flow.name});
};

/** Every concept's complete export set, in one archive, for handoff and record. */
async function v5ExportAllConcepts(){
  var concepts=listGeneratedConcepts(state.project);
  if(concepts.length<2){announce('Generate the three concepts before exporting the archive.');return}
  announce('Building the all-concepts archive…');
  var manifest={
    schemaVersion:'sbs-concept-set-archive/1.0',
    builder:'SBS DST Page Builder '+SBS_BUILDER_VERSION,
    generatedAt:new Date().toISOString(),
    client:v2ClientMeta(state.project),
    note:'One folder per concept. WordPress imports one concept at a time; this archive is for handoff and record.',
    concepts:[]
  };
  var payload=concepts.map(function(concept){
    return v5WithConcept(concept.id,function(active){
      manifest.concepts.push(Object.assign({folder:active.slot},v5ConceptMeta(state.project),{
        updatedAt:active.updatedAt,
        sections:state.project.sections.length,
        flowId:state.project.flowId
      }));
      return {
        slot:active.slot,
        navigation:buildNavigationExport(state.project),
        footer:buildFooterExport(state.project),
        page:buildPageExport(state.project),
        websiteHtml:buildSiteDocument(state.project,{includePreview:false})
      };
    });
  });
  try{
    var blob=await createConceptSetBundle({concepts:payload,manifest:manifest});
    downloadBlob(slugify(state.project.brief.projectName||state.project.brief.clientName)+'-all-concepts.zip',blob);
    announce('All-concepts archive downloaded');
  }catch(error){
    console.error(error);
    announce('Could not create the all-concepts archive');
  }
}

handleExport=async function(type){var slug=v5ExportSlug();if(type==='json')type='page';if(type==='all-concepts'){await v5ExportAllConcepts();return}if(type==='bundle'){try{announce('Building complete project ZIP…');var blob=await createProjectBundle({navigation:buildNavigationExport(state.project),footer:buildFooterExport(state.project),page:buildPageExport(state.project),websiteHtml:buildSiteDocument(state.project,{includePreview:false})});downloadBlob(slug+'-complete-project.zip',blob);announce('Complete project ZIP downloaded')}catch(error){console.error(error);announce('Could not create the project ZIP')}return}var map={navigation:{name:slug+'-navigation.json',data:function(){return buildNavigationExport(state.project)},message:'Navigation JSON downloaded'},footer:{name:slug+'-footer.json',data:function(){return buildFooterExport(state.project)},message:'Footer JSON downloaded'},page:{name:slug+'-page.json',data:function(){return buildPageExport(state.project)},message:'Page JSON downloaded'},globals:{name:slug+'-globals.json',data:function(){return buildGlobalsExport(state.project)},message:'Global parts JSON downloaded'}};if(map[type]){downloadFile(map[type].name,JSON.stringify(map[type].data(),null,2),'application/json');announce(map[type].message);return}if(type==='html'){downloadFile(slug+'-website.html',buildSiteDocument(state.project),'text/html');announce('Standalone website HTML downloaded');return}if(type==='copy'||type==='copy-page'){var text=JSON.stringify(buildPageExport(state.project),null,2);try{await navigator.clipboard.writeText(text);announce('Page JSON copied')}catch(e){var ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();announce('Page JSON copied')}}};

updateBinding=function(path,value,input){
  if(path.indexOf('global.')===0){inputCheckpoint();var localPath=path.replace(/^global\./,''),boolFields=['header.frostedGlass','header.hideOnScrollDown','header.announcementDismissible'];if(boolFields.includes(localPath))value=v2Bool(value);setPath(state.project,localPath,value);if(localPath==='header.logoText')state.project.header.logoTextCustom=true;if(localPath==='header.logoMark')state.project.header.logoMarkCustom=true;if(localPath==='footer.logoText')state.project.footer.logoTextCustom=true;if(localPath==='footer.logoMark')state.project.footer.logoMarkCustom=true;if(localPath==='footer.legal')state.project.footer.legalCustom=true;v2EnsureProject(state.project);if(input&&input.type==='range'){var opacityOut=input.parentElement&&input.parentElement.querySelector('output')||input.closest('.field')&&input.closest('.field').querySelector('output');if(opacityOut)opacityOut.textContent=Math.round(Number(value))+'%'}queueSave();queuePreview();
    // The mobile-menu select carries a note describing the style it chose, and a
    // note describing the previous one is worse than no note at all.
    if(localPath==='header.mobileMenu'){var menuHelp=input&&input.closest('.field')&&input.closest('.field').querySelector('.field-help');if(menuHelp)menuHelp.textContent=v2MobileMenuHelp(value)}
    return}
  var beforeName=state.project.brief.clientName,beforeProject=state.project.brief.projectName;
  // Picking a colour by hand is a decision, so it is kept verbatim from here on
  // and only reported by the preflight. Applying an archetype or a concept
  // hands the palette back to the system and clears this.
  if(path.indexOf('design.palette.')===0)state.project.design.paletteLocked=true;
  legacyUpdateBindingV1(path,value,input);if(path==='brief.clientName'){state.project.brief.clientNameCustom=true;v2SyncBrand(state.project,false)}if(path==='brief.projectName'&&!state.project.brief.clientNameCustom){state.project.brief.clientName=value;v2SyncBrand(state.project,false)}if(path.indexOf('setting.')===0){var parts=path.split('.'),s=state.project.sections.find(function(x){return x.id===parts[1]});if(s&&parts[2]==='headingAlign'){var h=firstNode(s.node,'ds-blocks/c-heading');if(h){h.attributes=h.attributes||{};h.attributes.alignment=value}}if(s&&parts[2]==='headingAlignMobile'){var hm=firstNode(s.node,'ds-blocks/c-heading');if(hm){hm.attributes=hm.attributes||{};hm.attributes.alignmentMobile=value}}}
  if(input&&input.type==='range'){var output=input.parentElement.querySelector('output'),key=path.split('.').pop();if(output)output.textContent=v2DialLabel(key,value)}queueSave();queuePreview();
};

byId('editorInner').addEventListener('input',function(e){var el=e.target;if(el.dataset.navItem!=null){inputCheckpoint();var item=state.project.header.nav[Number(el.dataset.navItem)];if(item){item[el.dataset.key==='url'?1:0]=el.value;queueSave();queuePreview()}}if(el.dataset.footerColumn!=null&&el.dataset.footerLink!=null){inputCheckpoint();var col=state.project.footer.columns[Number(el.dataset.footerColumn)],link=col&&col.links[Number(el.dataset.footerLink)];if(link){link[el.dataset.key==='url'?1:0]=el.value;queueSave();queuePreview()}}});
byId('editorInner').addEventListener('click',function(e){var action=e.target.closest('[data-global-action]');if(!action)return;var name=action.dataset.globalAction;mutate(function(){v2EnsureProject(state.project);if(name==='add-nav')state.project.header.nav.push(['New link','#section']);if(name==='remove-nav')state.project.header.nav.splice(Number(action.dataset.index),1);if(name==='reset-brand'){state.project.header.logoTextCustom=false;state.project.header.logoMarkCustom=false;state.project.footer.logoTextCustom=false;state.project.footer.logoMarkCustom=false;v2SyncBrand(state.project,true)}if(name==='add-footer-column')state.project.footer.columns.push({title:'New column',menuLocation:'footer-menu',links:[['New link','#']]});if(name==='remove-footer-column')state.project.footer.columns.splice(Number(action.dataset.column),1);if(name==='add-footer-link')state.project.footer.columns[Number(action.dataset.column)].links.push(['New link','#']);if(name==='remove-footer-link')state.project.footer.columns[Number(action.dataset.column)].links.splice(Number(action.dataset.link),1);
    // Back to the palette, which is an empty string — not a colour that happens
    // to match it today and would stop following the archetype tomorrow.
    if(name==='clear-color')setPath(state.project,String(action.dataset.path||'').replace(/^global\./,''),'')},{message:'Global part updated'})});

// A colour picker fires on every drag. Re-rendering the panel mid-drag would
// tear the native picker away, so the row patches its own label and only a
// committed change (mouse up, or the Reset button) rebuilds the panel.
byId('editorInner').addEventListener('input',function(event){
  var input=event.target;
  if(input.type!=='color'||!input.dataset.bind||input.dataset.bind.indexOf('global.')!==0)return;
  var row=input.closest('.color-override');
  if(!row)return;
  row.classList.add('is-custom');
  var label=row.querySelector('.color-override__state');
  if(label)label.textContent=String(input.value||'').toUpperCase();
});
byId('editorInner').addEventListener('change',function(event){
  var input=event.target;
  if(input.type==='color'&&input.dataset.bind&&input.dataset.bind.indexOf('global.')===0)renderEditor();
});
byId('projectTitle').addEventListener('input',function(e){state.project.brief.projectName=e.target.value;if(!state.project.brief.clientNameCustom)state.project.brief.clientName=e.target.value;v2SyncBrand(state.project,false);queueSave();queuePreview()});

applyArchetype=function(key){state.project.design.paletteLocked=false;state.project.design.paletteSignature='';legacyApplyArchetypeV1(key);var arch=DATA.archetypes[key]||{},header=arch.header||{};if(header.displayType)state.project.header.position=header.displayType;if(header.logoPosition)state.project.header.variant=header.logoPosition==='center'?'centered':'standard';if(header.frostedGlass!=null)state.project.header.frostedGlass=!!header.frostedGlass;if(header.hideOnScroll!=null)state.project.header.hideOnScrollDown=!!header.hideOnScroll;queueSave();queuePreview()};
updateTop=function(){v2EnsureProject(state.project);var b=state.project.brief;byId('projectTitle').value=b.projectName||state.project.client||'Untitled project';byId('previewUrl').textContent=slugify(b.projectName)+'.local';byId('patternCount').textContent=DATA.skill.patternCount;byId('componentCount').textContent=Object.keys(DATA.registry).filter(function(k){return k.indexOf('ds-blocks/')===0}).length;var topExport=byId('topExportBtn'),topLabel=topExport&&topExport.querySelector('span');if(topLabel)topLabel.textContent='Export page JSON';var sub=document.querySelector('.brand-copy span');if(sub)sub.textContent='Concept Studio · v2'};

/*
 * Layout fidelity keeps the editor controls and the WordPress-facing block
 * attributes in lockstep. The section model is intentionally only a mirror
 * for the panel; the DST node remains the exported source of truth.
 */
function fidelityNode(section,components){
  var target=null;
  if(!section||!section.node)return target;
  walkNode(section.node,function(node){if(!target&&components.indexOf(node.component)!==-1)target=node});
  return target;
}
function fidelityNumber(value,fallback,max){
  var number=Number(value);
  if(!Number.isFinite(number))number=fallback;
  return Math.max(1,Math.min(max||12,Math.round(number)));
}
function fidelityOpacity(value,fallback){
  var number=Number(value);
  if(!Number.isFinite(number))number=fallback;
  return Math.max(0,Math.min(1,number));
}
function fidelityPadding(attributes,layout){
  var padding=attributes.dsPadding&&typeof attributes.dsPadding==='object'?deepClone(attributes.dsPadding):{};
  padding.top={...(padding.top||{}),type:layout.paddingTop||'default'};
  padding.bottom={...(padding.bottom||{}),type:layout.paddingBottom||'default'};
  attributes.dsPadding=padding;
}
function fidelityLayoutColumnDefault(section,fidelity){
  if(!fidelity||!fidelity.columns||String(section.patternId||'').indexOf('sbs-layout-')!==0||section.family!=='text'||fidelity.columns.layoutDefaultApplied)return;
  fidelity.columns.desktop=1;
  fidelity.columns.layoutDefaultApplied=true;
}
function fidelityEnsureSection(section){
  if(!section||!section.node)return null;
  if(section.fidelity&&section.fidelity.version===1){
    if(!section.fidelity.surface)section.fidelity.surface={};
    if(typeof section.fidelity.surface.sidePadding!=='boolean')section.fidelity.surface.sidePadding=true;
    if(!Number.isFinite(Number(section.fidelity.surface.backgroundOpacity)))section.fidelity.surface.backgroundOpacity=1;
    if(!Number.isFinite(Number(section.fidelity.surface.gradientStartOpacity)))section.fidelity.surface.gradientStartOpacity=1;
    if(!Number.isFinite(Number(section.fidelity.surface.gradientEndOpacity)))section.fidelity.surface.gradientEndOpacity=1;
    if(!section.fidelity.surface.toneManaged){section.fidelity.surface.backgroundColor=section.layout&&section.layout.inverted?fidelityRgba(state.project.design.palette.dark,1):'';section.fidelity.surface.toneManaged=true}
    fidelityLayoutColumnDefault(section,section.fidelity);
    return section.fidelity;
  }
  var surface=fidelityNode(section,['ds-blocks/dst-wrapper','ds-blocks/dst-banner','ds-blocks/ds-columns','ds-blocks/c-cards','ds-blocks/c-list','ds-blocks/l-content-2'])||section.node;
  var columns=fidelityNode(section,['ds-blocks/ds-columns']);
  var cards=fidelityNode(section,['ds-blocks/c-cards']);
  var list=fidelityNode(section,['ds-blocks/c-list']);
  var surfaceAttrs=surface.attributes||{};
  section.fidelity={
    version:1,
    surface:{
      targetId:surface.id,
      // New SBS modules always keep a readable gutter. Turning it off is an
      // explicit editor decision, not an inherited pattern default.
      sidePadding:true,
      backgroundColor:section.layout&&section.layout.inverted?fidelityRgba(state.project.design.palette.dark,1):'',
      backgroundOpacity:1,
      /*
       * A *banner* that names an overlay colour but never sets the boolean —
       * most of the p89 heroes — had the scrim it was drawn with dropped the
       * moment the section became editable, and the headline lost its ground.
       * On a banner the colour is the intent and the flag is only an explicit
       * *off*, because a banner is a photograph with words on it.
       *
       * Nowhere else. A wrapper, a card grid or a list that carries an overlay
       * colour with the flag unset is a value the catalogue left switched off on
       * purpose, and reading it as intent painted eleven ordinary sections with
       * a full-strength wash of the accent or of white — which is exactly the
       * "bright band, bright text" this was supposed to prevent.
       */
      overlayEnabled:surfaceAttrs.backgroundOverlayEnabled===false
        ? false
        : !!(surfaceAttrs.backgroundOverlayEnabled
          ||(surface.component==='ds-blocks/dst-banner'&&cleanText(surfaceAttrs.backgroundOverlay))),
      overlay:cleanCssValue(surfaceAttrs.backgroundOverlay),
      overlayOpacity:fidelityOpacity(surfaceAttrs.backgroundOverlayOpacity,.5),
      gradientStartOpacity:1,
      gradientEndOpacity:1,
      overlayBlur:surfaceAttrs.backgroundOverlayBlur||'',
      overlayBlend:surfaceAttrs.backgroundOverlayMixBlend||'normal',
      toneManaged:true
    },
    columns:columns?{
      targetId:columns.id,
      desktop:fidelityNumber(columns.attributes&&columns.attributes.desktopColumnsPerRow||columns.attributes&&columns.attributes.count,1,12),
      tablet:fidelityNumber(columns.attributes&&columns.attributes.tabletCount||columns.attributes&&columns.attributes.flexItemsPerRowTablet,1,6),
      mobile:fidelityNumber(columns.attributes&&columns.attributes.mobileCount||columns.attributes&&columns.attributes.flexItemsPerRowMobile,1,3),
      gap:columns.attributes&&columns.attributes.gap||'3rem',
      gapTablet:columns.attributes&&columns.attributes.gapTablet||columns.attributes&&columns.attributes.gap||'3rem',
      gapMobile:columns.attributes&&columns.attributes.gapMobile||'2rem',
      verticalAlign:columns.attributes&&columns.attributes.verticalAlign||'stretch',
      reverseMobile:!!(columns.attributes&&columns.attributes.reverseMobile)
    }:null,
    cards:cards?{
      targetId:cards.id,
      desktop:fidelityNumber(cards.attributes&&cards.attributes.columnsDesktop||cards.attributes&&cards.attributes.columns,1,6),
      tablet:fidelityNumber(cards.attributes&&cards.attributes.columnsTablet,1,4),
      mobile:fidelityNumber(cards.attributes&&cards.attributes.columnsMobile,1,3),
      gapHorizontal:cards.attributes&&cards.attributes.gapHorizontal||'2.4rem',
      gapHorizontalTablet:cards.attributes&&cards.attributes.gapHorizontalTablet||cards.attributes&&cards.attributes.gapHorizontal||'2.4rem',
      gapHorizontalMobile:cards.attributes&&cards.attributes.gapHorizontalMobile||'1.6rem',
      gapVertical:cards.attributes&&cards.attributes.gapVertical||'2.4rem',
      gapVerticalTablet:cards.attributes&&cards.attributes.gapVerticalTablet||cards.attributes&&cards.attributes.gapVertical||'2.4rem',
      gapVerticalMobile:cards.attributes&&cards.attributes.gapVerticalMobile||'1.6rem',
      horizontal:cards.attributes&&Object.prototype.hasOwnProperty.call(cards.attributes,'isHorizontal')?!!cards.attributes.isHorizontal:section.family==='testimonial',
      imageTextRatio:cards.attributes&&cards.attributes.imageTextRatio||''
    }:null,
    list:list?{
      targetId:list.id,
      desktop:fidelityNumber(list.attributes&&list.attributes.colCount,1,6),
      tablet:fidelityNumber(list.attributes&&list.attributes.colCountTablet,1,4),
      mobile:fidelityNumber(list.attributes&&list.attributes.colCountMobile,1,3),
      gap:list.attributes&&list.attributes.gapVertical||list.attributes&&list.attributes.gapBetween||'2.4rem',
      gapTablet:list.attributes&&list.attributes.gapVerticalTablet||list.attributes&&list.attributes.gapBetweenTablet||list.attributes&&list.attributes.gapVertical||'2.4rem',
      gapMobile:list.attributes&&list.attributes.gapVerticalMobile||list.attributes&&list.attributes.gapBetweenMobile||'1.6rem',
      layoutVariant:list.attributes&&list.attributes.layoutVariant||'grid'
    }:null
  };
  fidelityLayoutColumnDefault(section,section.fidelity);
  return section.fidelity;
}
function fidelityFindNode(node,id){
  var target=null;
  if(!node||!id)return target;
  walkNode(node,function(candidate){if(!target&&candidate.id===id)target=candidate});
  return target;
}
function fidelityTarget(section,settings,components){
  var target=fidelityFindNode(section.node,settings&&settings.targetId);
  if(target&&components.indexOf(target.component)===-1)target=null;
  target=target||fidelityNode(section,components);
  if(target&&settings)settings.targetId=target.id;
  return target;
}
function fidelityExportTarget(node,settings,components){
  var target=fidelityFindNode(node,settings&&settings.targetId);
  if(target&&components.indexOf(target.component)===-1)target=null;
  return target||fidelityNode({node:node},components);
}
var FIDELITY_SURFACE_COMPONENTS=['ds-blocks/dst-wrapper','ds-blocks/dst-banner','ds-blocks/ds-columns','ds-blocks/c-cards','ds-blocks/c-list','ds-blocks/l-content-2'];
function fidelityApplySurface(attributes,section,settings){
  attributes.dsContainerSideGap=!!settings.sidePadding;
  attributes.backgroundColor=settings.backgroundColor||'';
  attributes.backgroundOverlayEnabled=!!settings.overlayEnabled;
  attributes.backgroundOverlay=settings.overlay||'';
  attributes.backgroundOverlayOpacity=fidelityOpacity(settings.overlayOpacity,.5);
  attributes.backgroundOverlayBlur=settings.overlayBlur||'';
  attributes.backgroundOverlayMixBlend=settings.overlayBlend||'';
  fidelityPadding(attributes,section.layout||{});
}
function fidelityApplySection(section){
  var fidelity=fidelityEnsureSection(section);
  if(!fidelity)return;
  var surface=fidelityTarget(section,fidelity.surface,FIDELITY_SURFACE_COMPONENTS)||section.node;
  surface.attributes=surface.attributes||{};
  fidelityApplySurface(surface.attributes,section,fidelity.surface);
  if(fidelity.columns){
    var columns=fidelityTarget(section,fidelity.columns,['ds-blocks/ds-columns']);
    if(columns){
      columns.attributes=columns.attributes||{};
      columns.attributes.desktopColumnsPerRow=fidelityNumber(fidelity.columns.desktop,1,12);
      columns.attributes.tabletCount=fidelityNumber(fidelity.columns.tablet,1,6);
      columns.attributes.mobileCount=fidelityNumber(fidelity.columns.mobile,1,3);
      columns.attributes.gap=fidelity.columns.gap||'3rem';
      columns.attributes.gapTablet=fidelity.columns.gapTablet||columns.attributes.gap;
      columns.attributes.gapMobile=fidelity.columns.gapMobile||'2rem';
      columns.attributes.verticalAlign=fidelity.columns.verticalAlign||'stretch';
      columns.attributes.reverseMobile=!!fidelity.columns.reverseMobile;
    }
  }
  if(fidelity.cards){
    var cards=fidelityTarget(section,fidelity.cards,['ds-blocks/c-cards']);
    if(cards){
      cards.attributes=cards.attributes||{};
      cards.attributes.columnsDesktop=fidelityNumber(fidelity.cards.desktop,1,6);
      cards.attributes.columnsTablet=fidelityNumber(fidelity.cards.tablet,1,4);
      cards.attributes.columnsMobile=fidelityNumber(fidelity.cards.mobile,1,3);
      cards.attributes.gapHorizontal=fidelity.cards.gapHorizontal||'2.4rem';
      cards.attributes.gapHorizontalTablet=fidelity.cards.gapHorizontalTablet||cards.attributes.gapHorizontal;
      cards.attributes.gapHorizontalMobile=fidelity.cards.gapHorizontalMobile||'1.6rem';
      cards.attributes.gapVertical=fidelity.cards.gapVertical||'2.4rem';
      cards.attributes.gapVerticalTablet=fidelity.cards.gapVerticalTablet||cards.attributes.gapVertical;
      cards.attributes.gapVerticalMobile=fidelity.cards.gapVerticalMobile||'1.6rem';
      cards.attributes.isHorizontal=!!fidelity.cards.horizontal;
      cards.attributes.imageTextRatio=fidelity.cards.imageTextRatio||'';
    }
  }
  if(fidelity.list){
    var list=fidelityTarget(section,fidelity.list,['ds-blocks/c-list']);
    if(list){
      list.attributes=list.attributes||{};
      list.attributes.colCount=fidelityNumber(fidelity.list.desktop,1,6);
      list.attributes.colCountTablet=fidelityNumber(fidelity.list.tablet,1,4);
      list.attributes.colCountMobile=fidelityNumber(fidelity.list.mobile,1,3);
      list.attributes.gapVertical=fidelity.list.gap||'2.4rem';
      list.attributes.gapVerticalTablet=fidelity.list.gapTablet||list.attributes.gapVertical;
      list.attributes.gapVerticalMobile=fidelity.list.gapMobile||'1.6rem';
      list.attributes.layoutVariant=fidelity.list.layoutVariant||'grid';
    }
  }
}

var ensureSectionSettingsBeforeFidelity=ensureSectionSettings;
ensureSectionSettings=function(section){
  var result=ensureSectionSettingsBeforeFidelity(section);
  fidelityEnsureSection(section);
  return result;
};
var syncSectionNodeBeforeFidelity=syncSectionNode;
syncSectionNode=function(section){
  syncSectionNodeBeforeFidelity(section);
  fidelityApplySection(section);
};

function fidelityGroup(title,description,content){
  return '<section class="fidelity-group"><div class="fidelity-group__head"><h3>'+esc(title)+'</h3><p>'+esc(description)+'</p></div><div class="field-grid">'+content+'</div></section>';
}
/**
 * A count — columns per row — as a slider. The maximum is the real ceiling the
 * applier clamps to, so the control cannot ask for a layout the block refuses.
 */
function fidelityNumberField(label,path,value,max,help){
  return rangeField(label,path,value,{min:1,max:max||12,step:1,fallback:1,full:false,help:help||''});
}

/** A gap, in the `rem` the design system is written in rather than a raw string. */
function fidelityGapField(label,path,value,help){
  return rangeField(label,path,value,{unit:'rem',min:0,max:10,step:.2,full:false,help:help||''});
}
function fidelityHexColor(value,fallback){
  var raw=String(value||'').trim(),rgba=raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i),match=raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if(rgba)return '#'+[rgba[1],rgba[2],rgba[3]].map(function(channel){return Math.max(0,Math.min(255,Number(channel))).toString(16).padStart(2,'0')}).join('');
  if(!match)return fallback;
  var hex=match[0];
  if(hex.length===4)return '#'+hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3];
  return hex.slice(0,7);
}
function fidelityColorOpacity(value,fallback){var match=String(value||'').match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/i),opacity=match?Number(match[1]):fallback;return fidelityOpacity(opacity,fallback)}
function fidelityRgba(value,opacity){var hex=fidelityHexColor(value,'#000000').slice(1),number=parseInt(hex,16),alpha=fidelityOpacity(opacity,1);return 'rgba('+((number>>16)&255)+', '+((number>>8)&255)+', '+(number&255)+', '+alpha.toFixed(2)+')'}
function fidelityGradientSettings(value,fallbackStart,fallbackEnd){
  var raw=String(value||''),fallback={angle:'90deg',start:fallbackStart,end:fallbackEnd,startOpacity:1,endOpacity:1},angle=raw.match(/linear-gradient\(\s*([^,]+)/i),colors=raw.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/ig);
  if(!colors||colors.length<2)return fallback;
  return {angle:fidelityGradientAngle(angle&&angle[1]),start:fidelityHexColor(colors[0],fallbackStart),end:fidelityHexColor(colors[1],fallbackEnd),startOpacity:fidelityColorOpacity(colors[0],1),endOpacity:fidelityColorOpacity(colors[1],1)};
}
/**
 * The direction select only offers five angles, so a catalogue gradient written
 * the other legal way — `to right`, `to bottom` — has to land on the matching
 * one. Without this the p89 v3 hero re-opened as a left-to-right gradient every
 * time, which is right by accident, and `to bottom` was silently rotated.
 */
var FIDELITY_GRADIENT_ANGLES={'to top':'0deg','to top right':'45deg','to right top':'45deg','to right':'90deg','to bottom right':'135deg','to right bottom':'135deg','to bottom':'180deg','to bottom left':'180deg','to left':'0deg','to top left':'0deg'};
function fidelityGradientAngle(value){
  var raw=cleanText(value).toLowerCase();
  if(['0deg','45deg','90deg','135deg','180deg'].indexOf(raw)!==-1)return raw;
  if(FIDELITY_GRADIENT_ANGLES[raw])return FIDELITY_GRADIENT_ANGLES[raw];
  var degrees=raw.match(/^(-?[\d.]+)deg$/);
  if(!degrees)return '90deg';
  // Anything else snaps to the nearest offered angle rather than being lost.
  var normalized=((Number(degrees[1])%360)+360)%360;
  return [0,45,90,135,180].reduce(function(best,candidate){
    return Math.abs(candidate-normalized)<Math.abs(best-normalized)?candidate:best;
  },0)+'deg';
}
function fidelitySwatches(path,active,allowDefault){
  var palette=state.project.design.palette||{},swatches=[['bg','Page'],['ink','Ink'],['accent','Accent'],['soft','Soft'],['dark','Dark']];
  return '<div class="fidelity-swatches">'+swatches.map(function(item){var value=palette[item[0]]||'#000000';return '<button type="button" class="fidelity-swatch '+(String(active).toLowerCase()===String(value).toLowerCase()?'is-active':'')+'" style="--swatch:'+escAttr(value)+'" data-fidelity-color-path="'+escAttr(path)+'" data-fidelity-color-value="'+escAttr(value)+'" aria-label="Use '+escAttr(item[1])+' color" title="Use '+escAttr(item[1])+' color"></button>'}).join('')+(allowDefault?'<button type="button" class="fidelity-color-reset" data-fidelity-color-path="'+escAttr(path)+'" data-fidelity-color-value="" title="Use the page background">Use page color</button>':'')+'</div>';
}
function fidelityColorControl(label,path,value,options){
  options=options||{};
  var selected=fidelityHexColor(value,options.fallback||state.project.design.palette.bg||'#FFFFFF'),opacity=fidelityColorOpacity(value,options.opacity==null?1:options.opacity);
  return '<div class="field full fidelity-color-control" data-fidelity-color-control data-fidelity-path="'+escAttr(path)+'"><label>'+esc(label)+'</label><div class="fidelity-color-picker"><input type="color" data-fidelity-color-value value="'+escAttr(selected)+'" aria-label="Choose '+escAttr(label)+'"><span class="fidelity-color-preview" style="--picked-color:'+escAttr(selected)+'"></span>'+fidelitySwatches(path,selected,!!options.allowDefault)+'</div><label class="fidelity-opacity">Opacity <output>'+Math.round(opacity*100)+'%</output><input type="range" min="0" max="100" value="'+Math.round(opacity*100)+'" data-fidelity-background-opacity></label>'+(options.help?'<div class="field-help">'+esc(options.help)+'</div>':'')+'</div>';
}
function fidelityOverlayControl(section,settings){
  var palette=state.project.design.palette||{},fallbackStart=fidelityHexColor(palette.dark,'#071C2A'),fallbackEnd=fidelityHexColor(palette.accent,'#B5412B'),isGradient=/linear-gradient\(/i.test(String(settings.overlay||'')),mode=settings.overlayEnabled?(isGradient?'gradient':'solid'):'off',gradient=fidelityGradientSettings(settings.overlay,fallbackStart,fallbackEnd),solid=fidelityHexColor(settings.overlay,fallbackStart),path='fidelity.'+section.id+'.surface',solidOpacity=fidelityColorOpacity(settings.overlay,1),startOpacity=fidelityOpacity(settings.gradientStartOpacity,gradient.startOpacity),endOpacity=fidelityOpacity(settings.gradientEndOpacity,gradient.endOpacity);
  return '<div class="field full fidelity-gradient-control" data-fidelity-overlay-control data-fidelity-path="'+escAttr(path)+'" data-mode="'+mode+'"><label>Image overlay</label><select data-fidelity-overlay-mode aria-label="Image overlay style"><option value="off" '+(mode==='off'?'selected':'')+'>No overlay</option><option value="solid" '+(mode==='solid'?'selected':'')+'>One color</option><option value="gradient" '+(mode==='gradient'?'selected':'')+'>Color gradient</option></select><div class="fidelity-gradient-preview" style="background:'+escAttr(mode==='gradient'?'linear-gradient('+gradient.angle+','+fidelityRgba(gradient.start,startOpacity)+','+fidelityRgba(gradient.end,endOpacity)+')':fidelityRgba(solid,solidOpacity))+'"></div><div class="fidelity-overlay-solid"><span>Overlay color</span><input type="color" data-fidelity-overlay-solid value="'+escAttr(solid)+'" aria-label="Overlay color">'+fidelitySwatches(path+'.overlay',solid,false)+'</div><div class="fidelity-overlay-gradient"><label>Gradient direction<select data-fidelity-gradient-angle><option value="0deg" '+(gradient.angle==='0deg'?'selected':'')+'>Bottom to top</option><option value="45deg" '+(gradient.angle==='45deg'?'selected':'')+'>Bottom left to top right</option><option value="90deg" '+(gradient.angle==='90deg'?'selected':'')+'>Left to right</option><option value="135deg" '+(gradient.angle==='135deg'?'selected':'')+'>Top left to bottom right</option><option value="180deg" '+(gradient.angle==='180deg'?'selected':'')+'>Top to bottom</option></select></label><label>Start color<input type="color" data-fidelity-gradient-start value="'+escAttr(gradient.start)+'"><output>'+Math.round(startOpacity*100)+'%</output><input type="range" min="0" max="100" value="'+Math.round(startOpacity*100)+'" data-fidelity-gradient-start-opacity></label><label>End color<input type="color" data-fidelity-gradient-end value="'+escAttr(gradient.end)+'"><output>'+Math.round(endOpacity*100)+'%</output><input type="range" min="0" max="100" value="'+Math.round(endOpacity*100)+'" data-fidelity-gradient-end-opacity></label></div><div class="field-help">Every color uses RGBA, so each gradient stop fades on its own. Overall strength is the slider below.</div></div>';
}
/*
 * Background and image overlay, whole and identical in both builders.
 *
 * This used to be an Extended-view-only group, which meant a strategist working
 * in the simple builder could see an unreadable hero and had no way to touch the
 * scrim causing it — the p89 v3 hero being the case that made it obvious. It is
 * the same markup in both places on purpose: there is no simple-enough version
 * of "make the words legible", only a version with sliders instead of numbers.
 */
function fidelitySurfaceGroup(section,fidelity){
  var path='fidelity.'+section.id+'.surface';
  return fidelityGroup('Background and image overlay','Set a section color, or darken the picture so the words on it stay readable. Drag the sliders — nothing here has to be typed.',
    fidelityColorControl('Background color',path+'.backgroundColor',fidelity.surface.backgroundColor,{allowDefault:true,help:'Pick from your page colors, or use the color picker for any custom color.'})+
    fidelityOverlayControl(section,fidelity.surface)+
    rangeField('Overlay strength',path+'.overlayOpacity',fidelity.surface.overlayOpacity,{scale:100,min:0,max:100,fallback:BANNER_OVERLAY_STRENGTH,help:'How much of the overlay colour covers the picture. Around 60% keeps a headline readable on almost any photograph.'})+
    rangeField('Overlay blur',path+'.overlayBlur',fidelity.surface.overlayBlur,{unit:'px',min:0,max:40,zeroEmpty:true,help:'Softens the picture behind the text. Leave it at 0 for a sharp image.'})+
    field('How the overlay mixes with the image',path+'.overlayBlend',fidelity.surface.overlayBlend,{type:'select',options:[['normal','Normal'],['multiply','Darker'],['screen','Lighter'],['overlay','High contrast'],['soft-light','Soft light']].map(function(value){return {value:value[0],label:value[1]}})})
  );
}

renderLayoutEditor=function(section){
  ensureSectionSettings(section);
  var layout=section.layout,effects=section.effects,motifs=Object.keys(DATA.decorations).sort(),fidelity=section.fidelity;
  var heading=firstNode(section.node,'ds-blocks/c-heading'),headingAttributes=heading&&heading.attributes||{};
  var base=fidelityGroup('Width and spacing','Choose how wide this section feels and how much space it has above and below.',
    field('Content width','setting.'+section.id+'.container',layout.container,{type:'select',options:[{value:'default',label:'Standard width'},{value:'alt',label:'Narrow width'},{value:'wide',label:'Wide width'},{value:'full',label:'Full width'}]})+
    field('Section tone','setting.'+section.id+'.inverted',String(layout.inverted),{type:'select',options:[{value:'false',label:'Light background'},{value:'true',label:'Dark background'}]})+
    field('Space above','setting.'+section.id+'.paddingTop',layout.paddingTop,{type:'select',options:[{value:'none',label:'None'},{value:'small',label:'Small'},{value:'default',label:'Medium'},{value:'large',label:'Large'}]})+
    field('Space below','setting.'+section.id+'.paddingBottom',layout.paddingBottom,{type:'select',options:[{value:'none',label:'None'},{value:'small',label:'Small'},{value:'default',label:'Medium'},{value:'large',label:'Large'}]})+
    field('Keep side padding','fidelity.'+section.id+'.surface.sidePadding',String(fidelity.surface.sidePadding),{type:'select',options:[{value:'true',label:'Yes (recommended)'},{value:'false',label:'No, use the full width'}],help:'Keeps the content away from the left and right edges. New modules start with this on.'})
  );
  var surface=fidelitySurfaceGroup(section,fidelity);
  var alignment=fidelityGroup('Text alignment','Choose where the heading and the supporting text sit on larger screens and phones.',
    field('Heading alignment','setting.'+section.id+'.headingAlign',layout.headingAlign||headingAttributes.alignment||'left',{type:'select',options:[{value:'left',label:'Left'},{value:'center',label:'Center'},{value:'right',label:'Right'}]})+
    field('Supporting text alignment','setting.'+section.id+'.contentAlign',layout.contentAlign||layout.headingAlign||headingAttributes.alignment||'left',{type:'select',options:[{value:'left',label:'Left'},{value:'center',label:'Center'},{value:'right',label:'Right'}]})+
    field('Mobile heading alignment','setting.'+section.id+'.headingAlignMobile',layout.headingAlignMobile||headingAttributes.alignmentMobile||headingAttributes.alignment||'left',{type:'select',options:[{value:'left',label:'Left'},{value:'center',label:'Center'},{value:'right',label:'Right'}]})+
    field('Mobile supporting text','setting.'+section.id+'.contentAlignMobile',layout.contentAlignMobile||layout.contentAlign||layout.headingAlignMobile||headingAttributes.alignmentMobile||headingAttributes.alignment||'left',{type:'select',options:[{value:'left',label:'Left'},{value:'center',label:'Center'},{value:'right',label:'Right'}]})
  );
  var responsive='';
  if(fidelity.columns){
    var columns=fidelity.columns;
    responsive+=fidelityGroup('Columns on each screen','Set how many columns people see on desktop, tablet, and mobile.',
      fidelityNumberField('Desktop columns','fidelity.'+section.id+'.columns.desktop',columns.desktop,12)+
      fidelityNumberField('Tablet columns','fidelity.'+section.id+'.columns.tablet',columns.tablet,6)+
      fidelityNumberField('Mobile columns','fidelity.'+section.id+'.columns.mobile',columns.mobile,3)+
      fidelityGapField('Desktop gap','fidelity.'+section.id+'.columns.gap',columns.gap)+
      fidelityGapField('Tablet gap','fidelity.'+section.id+'.columns.gapTablet',columns.gapTablet)+
      fidelityGapField('Mobile gap','fidelity.'+section.id+'.columns.gapMobile',columns.gapMobile)+
      field('Vertical alignment','fidelity.'+section.id+'.columns.verticalAlign',columns.verticalAlign,{type:'select',options:['start','center','stretch','end'].map(function(value){return {value:value,label:value}})})+
      field('Reverse on mobile','fidelity.'+section.id+'.columns.reverseMobile',String(columns.reverseMobile),{type:'select',options:[{value:'false',label:'No'},{value:'true',label:'Yes'}]})
    );
  }
  if(fidelity.cards){
    var cards=fidelity.cards;
    responsive+=fidelityGroup('Cards','Set the card layout and spacing for each screen size.',
      fidelityNumberField('Desktop columns','fidelity.'+section.id+'.cards.desktop',cards.desktop,6)+
      fidelityNumberField('Tablet columns','fidelity.'+section.id+'.cards.tablet',cards.tablet,4)+
      fidelityNumberField('Mobile columns','fidelity.'+section.id+'.cards.mobile',cards.mobile,3)+
      field('Card orientation','fidelity.'+section.id+'.cards.horizontal',String(cards.horizontal),{type:'select',options:[{value:'false',label:'Vertical cards'},{value:'true',label:'Horizontal cards'}]})+
      field('Image / text ratio','fidelity.'+section.id+'.cards.imageTextRatio',cards.imageTextRatio,{help:'Example: 32%. Leave it empty to let the card decide.'})+
      fidelityGapField('Desktop horizontal gap','fidelity.'+section.id+'.cards.gapHorizontal',cards.gapHorizontal)+
      fidelityGapField('Tablet horizontal gap','fidelity.'+section.id+'.cards.gapHorizontalTablet',cards.gapHorizontalTablet)+
      fidelityGapField('Mobile horizontal gap','fidelity.'+section.id+'.cards.gapHorizontalMobile',cards.gapHorizontalMobile)+
      fidelityGapField('Desktop vertical gap','fidelity.'+section.id+'.cards.gapVertical',cards.gapVertical)+
      fidelityGapField('Tablet vertical gap','fidelity.'+section.id+'.cards.gapVerticalTablet',cards.gapVerticalTablet)+
      fidelityGapField('Mobile vertical gap','fidelity.'+section.id+'.cards.gapVerticalMobile',cards.gapVerticalMobile)
    );
  }
  if(fidelity.list){
    var list=fidelity.list;
    responsive+=fidelityGroup('Lists and statistics','Set the number of items shown in each row and the space between them.',
      fidelityNumberField('Desktop columns','fidelity.'+section.id+'.list.desktop',list.desktop,6)+
      fidelityNumberField('Tablet columns','fidelity.'+section.id+'.list.tablet',list.tablet,4)+
      fidelityNumberField('Mobile columns','fidelity.'+section.id+'.list.mobile',list.mobile,3)+
      field('Layout mode','fidelity.'+section.id+'.list.layoutVariant',list.layoutVariant,{type:'select',options:['grid','flex','timeline'].map(function(value){return {value:value,label:value}})})+
      fidelityGapField('Desktop gap','fidelity.'+section.id+'.list.gap',list.gap)+
      fidelityGapField('Tablet gap','fidelity.'+section.id+'.list.gapTablet',list.gapTablet)+
      fidelityGapField('Mobile gap','fidelity.'+section.id+'.list.gapMobile',list.gapMobile)
    );
  }
  if(section.family==='hero'||section.node.component==='ds-blocks/dst-banner'){
    responsive+=fidelityGroup('Hero media','Makes the visual composition explicit instead of relying on an accidental crop.',
      field('Hero image treatment','setting.'+section.id+'.heroMediaMode',layout.heroMediaMode||'full',{type:'select',full:true,options:[{value:'full',label:'Full-bleed background'},{value:'split-right',label:'Split image · right'},{value:'split-left',label:'Split image · left'}]})
    );
  }
  var motion=fidelityGroup('Animation','Choose a subtle entrance or a scroll effect. Leave both as None for a still section.',
    field('When this section appears','effect.'+section.id+'.viewport',effects.viewport||'',{type:'select',options:[['','None'],['fade','Fade in'],['fade-up','Fade up'],['fade-down','Fade down'],['fade-left','Fade from left'],['fade-right','Fade from right'],['zoom-in','Zoom in'],['slide-up','Slide up'],['animate-headings','Animate headings']].map(function(value){return {value:value[0],label:value[1]}})})+
    field('While people scroll','effect.'+section.id+'.scroll',effects.scroll||'',{type:'select',options:[['','None'],['bg-zoom-in','Background zooms in'],['bg-zoom-out','Background zooms out'],['parallax-bg','Background parallax'],['parallax-up','Content moves up'],['parallax-down','Content moves down'],['scroll-fade','Fade while scrolling'],['reveal','Reveal content'],['zoom-scrub','Zoom while scrolling'],['rotate-scrub','Rotate while scrolling'],['cascade','Cascade items'],['highlight','Highlight content'],['stack-cards','Stack cards']].map(function(value){return {value:value[0],label:value[1]}})})
  );
  var decoration=fidelityGroup('Decorative pattern','Add a subtle pattern behind the content, or leave it off for a clean section.',
    field('Registered motif','decoration.'+section.id+'.motif',section.decoration&&section.decoration.motif||'',{type:'select',options:[{value:'',label:'None'}].concat(motifs.map(function(value){return {value:value,label:value}}))})+
    field('Position','decoration.'+section.id+'.position',section.decoration&&section.decoration.position||'cover',{type:'select',options:['cover','top-left','top-right','bottom-left','bottom-right','center','top','bottom'].map(function(value){return {value:value,label:value}})})+
    rangeField('Opacity','decoration.'+section.id+'.opacity',section.decoration&&section.decoration.opacity||.04,{scale:100,min:0,max:100,step:1,fallback:.04,full:false})+
    rangeField('Scale','decoration.'+section.id+'.scale',section.decoration&&section.decoration.scale||1,{scale:100,min:25,max:300,step:5,fallback:1,display:'%',full:false})
  );
  return base+surface+alignment+responsive+motion+decoration+'<div class="panel-note fidelity-note">Everything here is saved with this module and included when you export your page for WordPress. The DST tree is available for advanced developers only.</div>';
};

var updateBindingBeforeFidelity=updateBinding;
updateBinding=function(path,value,input){
  if(path.indexOf('fidelity.')!==0)return updateBindingBeforeFidelity(path,value,input);
  inputCheckpoint();
  var parts=path.split('.'),section=state.project.sections.find(function(candidate){return candidate.id===parts[1]});
  if(!section)return;
  var group=parts[2],key=parts[3],fidelity=fidelityEnsureSection(section);
  if(!fidelity[group]||!key)return;
  if(['sidePadding','overlayEnabled','reverseMobile','horizontal'].indexOf(key)!==-1)value=value==='true';
  if(['desktop','tablet','mobile'].indexOf(key)!==-1)value=fidelityNumber(value,1,group==='columns'?12:group==='cards'?6:6);
  if(['overlayOpacity','backgroundOpacity','gradientStartOpacity','gradientEndOpacity'].indexOf(key)!==-1)value=fidelityOpacity(value,key==='overlayOpacity'?.5:1);
  if(group==='surface'&&key==='backgroundColor')value=value?fidelityRgba(value,fidelityOpacity(fidelity.surface.backgroundOpacity,1)):'';
  if(group==='surface'&&key==='backgroundOpacity'&&fidelity.surface.backgroundColor)fidelity.surface.backgroundColor=fidelityRgba(fidelity.surface.backgroundColor,value);
  fidelity[group][key]=value;
  fidelityApplySection(section);
  queueSave();
  queuePreview();
};

function fidelityOverlayValue(control){
  var mode=control.querySelector('[data-fidelity-overlay-mode]').value;
  if(mode==='off')return {enabled:false,value:''};
  if(mode==='solid')return {enabled:true,value:fidelityRgba(control.querySelector('[data-fidelity-overlay-solid]').value,1)};
  var angle=control.querySelector('[data-fidelity-gradient-angle]').value,start=control.querySelector('[data-fidelity-gradient-start]').value,end=control.querySelector('[data-fidelity-gradient-end]').value,startOpacity=Number(control.querySelector('[data-fidelity-gradient-start-opacity]').value)/100,endOpacity=Number(control.querySelector('[data-fidelity-gradient-end-opacity]').value)/100;
  return {enabled:true,value:'linear-gradient('+angle+', '+fidelityRgba(start,startOpacity)+', '+fidelityRgba(end,endOpacity)+')'};
}
function updateFidelityOverlay(control){
  var path=control.dataset.fidelityPath,value=fidelityOverlayValue(control),preview=control.querySelector('.fidelity-gradient-preview');
  control.dataset.mode=control.querySelector('[data-fidelity-overlay-mode]').value;
  if(preview)preview.style.background=value.value||'transparent';
  updateBinding(path+'.gradientStartOpacity',Number(control.querySelector('[data-fidelity-gradient-start-opacity]').value)/100);
  updateBinding(path+'.gradientEndOpacity',Number(control.querySelector('[data-fidelity-gradient-end-opacity]').value)/100);
  // Overall strength has its own slider directly beneath this control, so it is
  // deliberately not written here: two inputs owning one value drift apart the
  // moment either is dragged without a full re-render.
  updateBinding(path+'.overlayEnabled',String(value.enabled));
  updateBinding(path+'.overlay',value.value);
}
function updateFidelityColor(control){
  var path=control.dataset.fidelityPath,color=control.querySelector('[data-fidelity-color-value]').value,opacity=Number(control.querySelector('[data-fidelity-background-opacity]').value)/100,preview=control.querySelector('.fidelity-color-preview'),output=control.querySelector('output');
  if(preview)preview.style.setProperty('--picked-color',color);
  if(output)output.textContent=Math.round(opacity*100)+'%';
  updateBinding(path.replace(/\.backgroundColor$/,'.backgroundOpacity'),opacity);
  updateBinding(path,color);
}
byId('editorInner').addEventListener('click',function(event){
  var button=event.target.closest('[data-fidelity-color-path]');
  if(!button)return;
  var path=button.dataset.fidelityColorPath,value=button.dataset.fidelityColorValue||'',control=button.closest('.fidelity-color-control,.fidelity-overlay-solid'),input=control&&control.querySelector('input[type="color"]');
  if(input&&value)input.value=value;
  var overlayControl=button.closest('[data-fidelity-overlay-control]');
  if(overlayControl){updateFidelityOverlay(overlayControl);return}
  var colorControl=button.closest('[data-fidelity-color-control]');
  if(colorControl){if(!value){updateBinding(path,'');return}colorControl.querySelector('[data-fidelity-color-value]').value=value;updateFidelityColor(colorControl);return}
  updateBinding(path,value,input);
});
byId('editorInner').addEventListener('input',function(event){
  var control=event.target.closest('[data-fidelity-overlay-control]');
  if(control&&event.target.matches('[data-fidelity-overlay-solid],[data-fidelity-gradient-start],[data-fidelity-gradient-end],[data-fidelity-gradient-start-opacity],[data-fidelity-gradient-end-opacity]'))updateFidelityOverlay(control);
  var colorControl=event.target.closest('.fidelity-color-control');
  if(colorControl&&event.target.matches('[data-fidelity-color-value],[data-fidelity-background-opacity]'))updateFidelityColor(colorControl);
});
byId('editorInner').addEventListener('change',function(event){
  var control=event.target.closest('[data-fidelity-overlay-control]');
  if(control&&event.target.matches('[data-fidelity-overlay-mode],[data-fidelity-gradient-angle],[data-fidelity-overlay-solid],[data-fidelity-gradient-start],[data-fidelity-gradient-end],[data-fidelity-gradient-start-opacity],[data-fidelity-gradient-end-opacity]'))updateFidelityOverlay(control);
});

var v2RenderBackgroundBeforeFidelity=v2RenderBackground;
v2RenderBackground=function(raw,attributes,section){
  attributes=attributes||{};
  var fallback=section?mediaChoice(section,0):null,layers=v2BackgroundLayers(raw,fallback);
  if(!layers)return '';
  var overlay='';
  if(attributes.backgroundOverlayEnabled!==false&&(attributes.backgroundOverlay||section&&['hero','cta'].includes(section.family))){
    var background=cleanCssValue(attributes.backgroundOverlay)||'linear-gradient(90deg,rgba(0,0,0,.78),rgba(0,0,0,.18))',opacity=Number(attributes.backgroundOverlayOpacity),blur=cleanCssValue(attributes.backgroundOverlayBlur)?'filter:blur('+cleanCssValue(attributes.backgroundOverlayBlur)+');':'',blend=attributes.backgroundOverlayMixBlend&&attributes.backgroundOverlayMixBlend!=='normal'?'mix-blend-mode:'+attributes.backgroundOverlayMixBlend+';':'';
    overlay='<div class="c-overlay" style="background:'+escAttr(background)+';opacity:'+(Number.isFinite(opacity)?opacity:1)+';'+escAttr(blur+blend)+'"></div>';
  }
  return '<div class="c-bg">'+layers+'</div>'+overlay;
};

var renderNodeBeforeFidelity=renderNode;
renderNode=function(node,ctx){
  if(!node)return '';
  var attributes=node.attributes||{},component=node.component;
  if(component==='ds-blocks/c-cards'){
    var slider=!!(attributes.enableDstSlider||attributes.enableSlider||attributes.slider||ctx.family==='slider'||ctx.family==='testimonial'),columns=Math.max(1,Number(attributes.columnsDesktop||attributes.columns||1)),columnsTablet=Math.max(1,Number(attributes.columnsTablet||Math.min(2,columns))),columnsMobile=Math.max(1,Number(attributes.columnsMobile||1)),settings=attributes.dstSliderSettings||{},alignment=v2NormalizeAlign(attributes.alignment||'left','left'),classes=['dst-cards',slider?'has-dst-slider-bleed-right':'',attributes.enableStickyCards?'has-sticky-cards':''].filter(Boolean).join(' '),gridClasses=['dst-cards__grid',slider?'dst-slider':'','text-'+alignment,attributes.isHorizontal?'is-horizontal':'',settings.bleedRight?'has-right-bleed':'',settings.bleedBoth?'has-both-sides-bleed':'',attributes.enableStickyCards?'cards-sticky cards-sticky-'+(attributes.stickyPosition||'top'):''].filter(Boolean).join(' '),style='--col:'+columns+';--col-t:'+columnsTablet+';--col-m:'+columnsMobile+';--card-gap-x:'+escAttr(attributes.gapHorizontal||'var(--sbs-grid-gap)')+';--card-gap-x-t:'+escAttr(attributes.gapHorizontalTablet||attributes.gapHorizontal||'var(--sbs-grid-gap)')+';--card-gap-x-m:'+escAttr(attributes.gapHorizontalMobile||attributes.gapHorizontal||'var(--sbs-grid-gap)')+';--card-gap-y:'+escAttr(attributes.gapVertical||'var(--sbs-grid-gap)')+';--card-gap-y-t:'+escAttr(attributes.gapVerticalTablet||attributes.gapVertical||'var(--sbs-grid-gap)')+';--card-gap-y-m:'+escAttr(attributes.gapVerticalMobile||attributes.gapVertical||'var(--sbs-grid-gap)')+';--dst-slider-cols:'+Math.min(columns,Number(settings.bleedRightVisibleItems||3))+';',cards='<div class="'+gridClasses+'" style="'+style+'">'+nodeChildren(node,{...ctx,inCards:true,cardSettings:attributes})+'</div>',controls=slider?'<div class="dst-slider__controls" data-arrows-position="'+escAttr(settings.arrowsPosition||'bottom')+'">'+(settings.showProgress!==false?'<div class="dst-slider__progress"><div class="dst-slider__progress-fill"></div></div>':'')+'<div class="dst-slider__nav"><button class="dst-slider__arrows -prev" aria-label="Previous">'+ICONS.arrow+'</button><button class="dst-slider__arrows -next" aria-label="Next">'+ICONS.arrow+'</button></div></div>':'';
    return '<div class="'+classes+'" '+(slider?'data-slider':'')+' data-dst-component="'+component+'">'+cards+controls+'</div>';
  }
  if(component==='ds-blocks/c-list'){
    var timeline=attributes.enableTimeline||attributes.layoutVariant==='timeline'||ctx.family==='timeline',listColumns=timeline?1:Math.max(1,Number(attributes.colCount||1)),listColumnsTablet=timeline?1:Math.max(1,Number(attributes.colCountTablet||Math.min(2,listColumns))),listColumnsMobile=timeline?1:Math.max(1,Number(attributes.colCountMobile||1)),listAlignment=v2NormalizeAlign(attributes.style&&attributes.style.typography&&attributes.style.typography.textAlign||'left','left'),spec=v2ContainerSpec(attributes,node.layout,'full'),listClasses=['dst-list',timeline?'list-timeline':'','text-'+listAlignment,attributes.layoutVariant==='flex'?'list-flex':'',attributes.enableBorder?'has-border':''].filter(Boolean).join(' '),listStyle='--dst-list__col:'+listColumns+';--dst-list__col-tablet:'+listColumnsTablet+';--dst-list__col-mobile:'+listColumnsMobile+';--dst-list__row-gap:'+escAttr(attributes.gapVertical||attributes.gapBetween||'2.4rem')+';--dst-list__element-gap:'+escAttr(attributes.gapBetweenContent||'1.8rem')+';';
    return '<div class="'+spec.className+' '+listClasses+'" style="'+escAttr(spec.style+listStyle)+'" '+(attributes.heroIsCounter||ctx.family==='stats'?'data-counter="true"':'')+' data-dst-component="'+component+'"><ul class="dst-list__grid">'+nodeChildren(node,{...ctx,listTimeline:timeline,listSettings:attributes})+'</ul></div>';
  }
  return renderNodeBeforeFidelity(node,ctx);
};

var normalizeExportSectionBeforeFidelity=normalizeExportSection;
normalizeExportSection=function(section){
  var node=normalizeExportSectionBeforeFidelity(section),fidelity=fidelityEnsureSection(section);
  if(!fidelity)return node;
  var surface=fidelityExportTarget(node,fidelity.surface,['ds-blocks/dst-wrapper','ds-blocks/dst-banner','ds-blocks/ds-columns','ds-blocks/c-cards','ds-blocks/c-list','ds-blocks/l-content-2'])||node;
  surface.attributes=surface.attributes||{};
  fidelityApplySurface(surface.attributes,section,fidelity.surface);
  if(fidelity.columns){
    var columns=fidelityExportTarget(node,fidelity.columns,['ds-blocks/ds-columns']);
    if(columns){columns.attributes=columns.attributes||{};columns.attributes.desktopColumnsPerRow=fidelityNumber(fidelity.columns.desktop,1,12);columns.attributes.tabletCount=fidelityNumber(fidelity.columns.tablet,1,6);columns.attributes.mobileCount=fidelityNumber(fidelity.columns.mobile,1,3);columns.attributes.gap=fidelity.columns.gap||'3rem';columns.attributes.gapTablet=fidelity.columns.gapTablet||columns.attributes.gap;columns.attributes.gapMobile=fidelity.columns.gapMobile||'2rem';columns.attributes.verticalAlign=fidelity.columns.verticalAlign||'stretch';columns.attributes.reverseMobile=!!fidelity.columns.reverseMobile}
  }
  if(fidelity.cards){
    var cards=fidelityExportTarget(node,fidelity.cards,['ds-blocks/c-cards']);
    if(cards){cards.attributes=cards.attributes||{};cards.attributes.columnsDesktop=fidelityNumber(fidelity.cards.desktop,1,6);cards.attributes.columnsTablet=fidelityNumber(fidelity.cards.tablet,1,4);cards.attributes.columnsMobile=fidelityNumber(fidelity.cards.mobile,1,3);cards.attributes.gapHorizontal=fidelity.cards.gapHorizontal||'2.4rem';cards.attributes.gapHorizontalTablet=fidelity.cards.gapHorizontalTablet||cards.attributes.gapHorizontal;cards.attributes.gapHorizontalMobile=fidelity.cards.gapHorizontalMobile||'1.6rem';cards.attributes.gapVertical=fidelity.cards.gapVertical||'2.4rem';cards.attributes.gapVerticalTablet=fidelity.cards.gapVerticalTablet||cards.attributes.gapVertical;cards.attributes.gapVerticalMobile=fidelity.cards.gapVerticalMobile||'1.6rem';cards.attributes.isHorizontal=!!fidelity.cards.horizontal;cards.attributes.imageTextRatio=fidelity.cards.imageTextRatio||''}
  }
  if(fidelity.list){
    var list=fidelityExportTarget(node,fidelity.list,['ds-blocks/c-list']);
    if(list){list.attributes=list.attributes||{};list.attributes.colCount=fidelityNumber(fidelity.list.desktop,1,6);list.attributes.colCountTablet=fidelityNumber(fidelity.list.tablet,1,4);list.attributes.colCountMobile=fidelityNumber(fidelity.list.mobile,1,3);list.attributes.gapVertical=fidelity.list.gap||'2.4rem';list.attributes.gapVerticalTablet=fidelity.list.gapTablet||list.attributes.gapVertical;list.attributes.gapVerticalMobile=fidelity.list.gapMobile||'1.6rem';list.attributes.layoutVariant=fidelity.list.layoutVariant||'grid'}
  }
  return node;
};

var siteCssBeforeFidelity=siteCss;
siteCss=function(project){
  return siteCssBeforeFidelity(project)+'\n.dst-cards__grid{column-gap:var(--card-gap-x,var(--sbs-grid-gap));row-gap:var(--card-gap-y,var(--sbs-grid-gap))}@media(max-width:1024px){.dst-cards__grid{column-gap:var(--card-gap-x-t,var(--card-gap-x,var(--sbs-grid-gap)));row-gap:var(--card-gap-y-t,var(--card-gap-y,var(--sbs-grid-gap)))}.dst-list__grid{grid-template-columns:repeat(var(--dst-list__col-tablet,var(--dst-list__col,1)),minmax(0,1fr))}}@media(max-width:680px){.dst-cards__grid{column-gap:var(--card-gap-x-m,var(--card-gap-x,var(--sbs-grid-gap)));row-gap:var(--card-gap-y-m,var(--card-gap-y,var(--sbs-grid-gap)))}.dst-list__grid{grid-template-columns:repeat(var(--dst-list__col-mobile,1),minmax(0,1fr))}}';
};

var sectionClassesBeforeTone=sectionClasses;
sectionClasses=function(section){return sectionClassesBeforeTone(section)+(section.layout&&section.layout.inverted?'':' is-style-colors-standard')};
var updateBindingBeforeTone=updateBinding;
updateBinding=function(path,value,input){
  var match=String(path||'').match(/^setting\.([^\.]+)\.inverted$/),result=updateBindingBeforeTone(path,value,input);
  if(!match)return result;
  var section=state.project.sections.find(function(candidate){return candidate.id===match[1]});
  if(!section)return result;
  var fidelity=fidelityEnsureSection(section),dark=v2Bool(value);
  fidelity.surface.backgroundColor=dark?fidelityRgba(state.project.design.palette.dark,1):'';
  fidelity.surface.backgroundOpacity=1;
  fidelity.surface.toneManaged=true;
  fidelityApplySection(section);
  queueSave();
  queuePreview();
  return result;
};
var siteCssBeforeTone=siteCss;
siteCss=function(project){return siteCssBeforeTone(project)+'\n#sbs-site .is-style-colors-inverted{color:var(--dst--base-text-color-alt)}#sbs-site .is-style-colors-inverted .c-heading__pre,#sbs-site .is-style-colors-inverted .c-heading__title,#sbs-site .is-style-colors-inverted .c-heading__sub,#sbs-site .is-style-colors-inverted .sbs-rich-text p,#sbs-site .is-style-colors-inverted .dst-list__title,#sbs-site .is-style-colors-inverted .dst-list__description{color:var(--dst--base-text-color-alt)!important}#sbs-site .is-style-colors-standard{color:var(--dst--base-text-color)}#sbs-site .is-style-colors-standard .c-heading__pre,#sbs-site .is-style-colors-standard .c-heading__title,#sbs-site .is-style-colors-standard .c-heading__sub,#sbs-site .is-style-colors-standard .sbs-rich-text p,#sbs-site .is-style-colors-standard .dst-list__title,#sbs-site .is-style-colors-standard .dst-list__description{color:var(--dst--base-text-color)!important}#sbs-site .c-heading__description.text-center,#sbs-site .c-heading__description.text-center .sbs-rich-text{text-align:center;margin-inline:auto}#sbs-site .c-heading__description.text-right,#sbs-site .c-heading__description.text-right .sbs-rich-text{text-align:right;margin-left:auto}#sbs-site .sbs-logo-item{display:flex!important;align-items:center!important;justify-content:center!important;padding:0!important;border:0!important}.sbs-logo-orb{width:clamp(8rem,9vw,13rem);aspect-ratio:1;display:grid;place-items:center;border-radius:50%;border:1px solid color-mix(in srgb,currentColor 45%,transparent);padding:1.2rem;text-align:center;font-size:clamp(1rem,1vw,1.35rem);font-weight:800;letter-spacing:.08em;line-height:1.15;overflow-wrap:anywhere}.is-style-colors-inverted .sbs-logo-orb{color:var(--dst--base-text-color-alt);background:rgba(255,255,255,.04)}';};

/*
 * v3 layer — design system, AI Brief Brain, and the two-level module editor.
 *
 * This is the outermost layer, so every override here wraps the *final* v2 and
 * layout-fidelity behaviour rather than an intermediate version of it. Three
 * responsibilities:
 *
 *   1. Design dials and button styles: one shared source of truth (shared/design)
 *      drives the editor controls, the live preview CSS and the theme export.
 *   2. The Brief Brain: the AI model reads Step 01's brief and writes content
 *      and page flows. The feature owns its network state; this layer owns every
 *      mutation of the project, so undo/autosave/preview keep one owner.
 *   3. Simple and Extended module views, so a strategist is not shown a padding
 *      token unless they ask for one.
 */

/* ---------------------------------------------------------------- *
 * More page flows
 * ---------------------------------------------------------------- */


/* ---------------------------------------------------------------- *
 * Design system state
 * ---------------------------------------------------------------- */

function v3EnsureCustomFlows(project){
  if(!Array.isArray(project.customFlows))project.customFlows=[];
  project.customFlows=project.customFlows.filter(function(flow){
    return flow&&typeof flow==='object'&&typeof flow.id==='string'&&Array.isArray(flow.families)&&flow.families.length;
  }).slice(0,20);
  // A typed flow lives on the project and is resolved through `allFlows`, so a
  // saved `flowId` still finds it without the catalogue growing per project.
}

/**
 * What the palette measures, under the swatches that produced it.
 *
 * A palette panel that shows five colours and nothing else asks the strategist
 * to judge legibility by eye, which is the judgement people are worst at and the
 * one this whole feature exists to make for them. Six ratios and, when the
 * system moved something, a plain sentence saying which and why.
 */
function v9PaletteHealth(design){
  var report=paletteContrastReport(design.palette),repairs=design.paletteRepairs||[];
  var rows=report.rows.map(function(row){
    return '<li class="'+(row.pass?'is-pass':'is-fail')+'"><span>'+esc(row.label)+'</span><b>'+row.ratio.toFixed(2)+':1</b></li>';
  }).join('');
  var note=repairs.length
    ? '<p class="palette-health__note">Adjusted for readability: '+esc(repairs.map(function(entry){return entry.role+' '+entry.from+' → '+entry.to}).join(', '))+'. Only lightness moved, so the hue you chose is intact.</p>'
    : (design.paletteLocked
      ? '<p class="palette-health__note">These are your own colours, kept exactly as picked. Nothing here is adjusted automatically.</p>'
      : '');
  return '<div class="palette-health'+(report.ok?'':' has-fail')+'">'+
    '<div class="palette-health__head"><b>'+(report.ok?'Every pairing is readable':report.failures.length+' pairing'+(report.failures.length===1?'':'s')+' below the floor')+'</b><small>WCAG AA</small></div>'+
    '<ul>'+rows+'</ul>'+note+'</div>';
}

function v3EnsureDesign(project){
  if(!project||typeof project!=='object')return project;
  var design=v5EnsureSlice(project,'design',function(){return {}});
  ensureDials(design);
  design.buttonStyle=normalizeButtonStyle(design.buttonStyle);
  v9EnsureLegiblePalette(design);
  v3EnsureCustomFlows(project);
  return project;
}

/*
 * Every palette in the builder passes through here.
 *
 * `v2EnsureProject` runs on load, on every save and before every render, so this
 * is the one place that sees a palette however it arrived: restored from a
 * project saved months ago, resolved from a concept, applied from an archetype,
 * or typed into a colour picker. A palette that cannot hold its own text is a
 * page nobody can read, and no amount of care upstream has ever been enough —
 * eight of the thirteen shipped archetypes failed at least one pair.
 *
 * Repairs are recorded rather than hidden. `paletteRepairs` is what the palette
 * panel and the preflight read, so the strategist is told "your dark band was
 * lightened because white text could not be read on it" instead of quietly
 * getting a colour they did not choose.
 */
/**
 * The palette roles this project's brief named, so the repair leaves them alone.
 *
 * Read from both briefs: the advanced builder's fields and the simple builder's
 * paragraph are the same statement written in two shapes, and a colour stated in
 * either one is stated.
 */
function v9PinnedRoles(){
  try{
    var fromFields=briefDirectives(state.project.brief).palette||{},
      paragraph=state.project.simple&&state.project.simple.briefText,
      fromParagraph=paragraph?briefDirectives({notes:paragraph}).palette||{}:{};
    return Object.keys({...fromParagraph,...fromFields});
  }catch(error){return []}
}

function v9EnsureLegiblePalette(design){
  if(!design||!design.palette||typeof design.palette!=='object')return design;
  /*
   * A colour somebody picked by hand is left exactly as they picked it.
   *
   * The guarantee is over what this builder *generates* — archetypes, concepts,
   * anything derived from a brief. A designer who deliberately drags the ink
   * towards the canvas is making a decision, and a tool that silently drags it
   * back is broken in a more annoying way than the one being prevented. The
   * preflight still says so, loudly, on the review step.
   */
  if(design.paletteLocked)return design;
  var signature=PALETTE_ROLE_KEYS.map(function(role){return String(design.palette[role]||'')}).join('|');
  // Cheap guard: this runs on every render, and repairing an unchanged palette
  // over and over would burn a search loop per frame for no answer.
  if(design.paletteSignature===signature)return design;
  /*
   * A colour the brief stated outright is immovable here too.
   *
   * "Our brand colour is #0B3D2E" survives every archetype, every concept and
   * every repair — the whole promise of a stated colour is that switching
   * options does not quietly renegotiate it. Where that leaves a relationship
   * tight, the preflight says so and the strategist decides.
   */
  var repaired=repairPalette(design.palette,{pin:v9PinnedRoles()});
  design.palette={...design.palette,...repaired.palette};
  design.paletteRepairs=repaired.repairs;
  design.paletteSignature=PALETTE_ROLE_KEYS.map(function(role){return String(design.palette[role]||'')}).join('|');
  return design;
}

var v2EnsureProjectBeforeV3=v2EnsureProject;
v2EnsureProject=function(project){var out=v2EnsureProjectBeforeV3(project);v3EnsureDesign(out);return out};

// Restored from the same payload queueSave writes; Basic is the default for
// anyone who has never chosen.
state.moduleView=saved&&saved.moduleView==='extended'?'extended':'simple';

/* ---------------------------------------------------------------- *
 * Preview and export
 * ---------------------------------------------------------------- */

var siteCssBeforeV3=siteCss;
siteCss=function(project){
  v3EnsureDesign(project);
  return siteCssBeforeV3(project)+'\n'+dialCss(project.design)+'\n'+buttonStyleCss(project.design.buttonStyle)
    +v3HeroFitCss()+v3AccordionDurations(project.design)+v3ComponentFitCss();
};

var buildSiteDocumentBeforeV3=buildSiteDocument;
buildSiteDocument=function(project,options){
  v3EnsureDesign(project);
  var attributes=dialDocumentAttributes(project.design);
  attributes['data-button-style']=project.design.buttonStyle;
  var serialized=Object.keys(attributes).map(function(name){return name+'="'+escAttr(attributes[name])+'"'}).join(' ');
  // v2 wrote three of these attributes itself. Remove that pair so the document
  // never carries a duplicate attribute with a stale value.
  return buildSiteDocumentBeforeV3(project,options)
    .replace(/ data-motion-level="[^"]*" data-density="[^"]*" data-expression="[^"]*"/,'')
    .replace('<main class="ver active" id="sbs-site"','<main class="ver active" id="sbs-site" '+serialized);
};

var buildThemeBeforeV3=buildTheme;
buildTheme=function(project,options){
  v3EnsureDesign(project);
  var theme=buildThemeBeforeV3(project,options),design=project.design,tokens=dialTokens(design);
  theme.designDials=DIAL_KEYS.reduce(function(out,key){out[key]=design[key];return out},{});
  theme.designDialLevels=dialLevels(design);
  // The complete resolved token set is exported so WordPress and any future
  // renderer consume the exact values the live preview used, not an
  // approximation reconstructed from the slider numbers.
  theme.designDialTokens=Object.assign({},tokens);
  theme.designDialSchemaVersion='sbs-design-dials/1.0';
  theme.buttonStyle=design.buttonStyle;
  // The exported WordPress theme must resolve to the same numbers the preview
  // used, or an imported page silently loses its rhythm.
  theme.layout=Object.assign({},theme.layout,{
    'default-radius':tokens.radius,
    'default-radius-mobile':tokens.radius,
    'default-container-width':tokens.containerWidth,
    'alt-container-width':tokens.altContainerWidth,
    'desktop-vertical-gap':tokens.sectionGap,
    'mobile-vertical-gap':tokens.mobileGap,
    'header-height':tokens.headerHeight,
    'card-padding':tokens.cardPadding,
    'grid-gap':tokens.gridGap
  });
  theme.typography=Object.assign({},theme.typography,{
    'fs-h1':tokens.h1,'fs-h2':tokens.h2,'fs-h3':tokens.h3,'fs-h4':tokens.h4,
    'title-letter-spacing':tokens.titleTracking,'pretitle-letter-spacing':tokens.pretitleTracking,
    'base-line-height':tokens.bodyLineHeight,'reading-measure':tokens.measure
  });
  theme.motion=Object.assign({},theme.motion,{
    duration:tokens.motionDuration,distance:tokens.motionDistance,stagger:tokens.motionStagger,
    easing:tokens.motionEase,hoverLift:tokens.hoverLift,level:dialLevels(design).motion
  });
  return theme;
};

/* ---------------------------------------------------------------- *
 * Step 02 — Direction: presets, dials, button styles
 * ---------------------------------------------------------------- */

function v3DialField(design,key){
  var dial=DIALS[key];
  return '<div class="dial" data-dial="'+key+'">'+
    '<label for="dial-'+key+'"><span>'+esc(dial.label)+'</span><output data-dial-output="'+key+'">'+esc(dialLabel(key,design[key]))+'</output></label>'+
    '<input id="dial-'+key+'" type="range" min="0" max="100" step="1" value="'+Number(design[key])+'" data-bind="design.'+key+'" aria-describedby="dial-help-'+key+'">'+
    '<div class="dial-scale"><span>'+esc(dial.min)+'</span><span>'+esc(dial.max)+'</span></div>'+
    '<p class="dial-help" id="dial-help-'+key+'">'+esc(dial.help)+'</p>'+
  '</div>';
}

function v3DialGroups(design){
  return DIAL_GROUPS.map(function(group){
    return '<section class="dial-group"><div class="dial-group-head"><h3>'+esc(group.label)+'</h3><p>'+esc(group.hint)+'</p></div>'+
      '<div class="dial-grid">'+group.dials.map(function(key){return v3DialField(design,key)}).join('')+'</div></section>';
  }).join('');
}

function v3PresetMatch(design){
  var match=DIAL_PRESETS.find(function(preset){
    return Object.keys(preset.values).every(function(key){return Number(design[key])===Number(preset.values[key])});
  });
  return match?match.id:'';
}

function v3PresetButtons(design){
  var active=v3PresetMatch(design);
  return '<div class="preset-grid">'+DIAL_PRESETS.map(function(preset){
    return '<button type="button" class="preset-card'+(active===preset.id?' is-active':'')+'" data-dial-preset="'+preset.id+'">'+
      '<b>'+esc(preset.label)+'</b><span>'+esc(preset.summary)+'</span></button>';
  }).join('')+'</div>';
}

/** Live sample of the dials that a strategist can see without scrolling. */
function v3DialSample(design){
  var tokens=dialTokens(design),palette=design.palette||{};
  var variables=[
    '--sample-gap:'+tokens.gridGap,'--sample-pad:'+tokens.cardPadding,'--sample-radius:'+tokens.radius,
    '--sample-lift:'+tokens.hoverLift,'--sample-duration:'+tokens.motionDuration,'--sample-ease:'+tokens.motionEase,
    '--sample-border:'+tokens.borderAlpha,'--sample-shadow:'+tokens.cardShadow,'--sample-lh:'+tokens.bodyLineHeight,
    '--sample-accent:'+(palette.accent||'#ed5b38'),'--sample-ink:'+(palette.ink||'#181a1d'),
    '--sample-bg:'+(palette.bg||'#ffffff'),'--sample-soft:'+(palette.soft||'#eeeae4'),
    '--sample-scale:'+tokens.typeScale,'--sample-tracking:'+tokens.titleTracking,
    '--sample-distance:'+tokens.motionDistance,'--sample-measure:'+tokens.measure,
    '--sample-stagger:'+tokens.motionStagger,'--sample-motion-scale:'+tokens.motionScale,
    '--sample-accent-rule:'+tokens.accentRule
  ].join(';');
  return '<div class="dial-sample" data-dial-sample style="'+escAttr(variables)+'">'+
    '<div class="dial-sample-row" aria-hidden="true">'+
      '<div class="dial-sample-card"><b>Space, type and surface</b>'+
      '<p>Body copy shows the reading width, the line height and the space inside a card.</p></div>'+
    '</div>'+
    '<div class="dial-sample-foot">'+
      '<span class="dial-sample-title" aria-hidden="true"><i class="dial-sample-accent"></i>Headline scale</span>'+
    '</div>'+
  '</div>';
}

function v3ButtonStylePanel(design){
  var palette=design.palette||{},tokens=dialTokens(design);
  var variables=[
    '--dst--primary-color2:'+(palette.accent||'#ed5b38'),
    '--dst--primary-color3:'+(palette.dark||'#181a1d'),
    '--dst--base-text-color:'+(palette.ink||'#181a1d'),
    '--dst--body-bg:'+(palette.bg||'#ffffff'),
    '--dst--default-radius:'+tokens.radius,
    '--sbs-motion-duration:'+tokens.motionDuration,
    '--sbs-motion-ease:'+tokens.motionEase,
    '--sbs-hover-lift:'+tokens.hoverLift,
    '--sbs-border-width:'+tokens.borderWidth,
    '--sbs-accent-rule:'+tokens.accentRule,
    '--sbs-on-accent:'+readableOn(palette.accent||'#ed5b38',['#ffffff',palette.ink||'#181a1d',palette.dark||'#181a1d']),
    '--sbs-on-ink:'+readableOn(palette.ink||'#181a1d',['#ffffff',palette.bg||'#ffffff',palette.soft||'#eeeae4'])
  ].join(';');
  return '<div class="btn-style-list" style="'+escAttr(variables)+'">'+BUTTON_STYLES.map(function(style){
    var selected=design.buttonStyle===style.id;
    return '<label class="btn-style-card'+(selected?' is-selected':'')+'">'+
      '<input type="radio" name="sbs-button-style" value="'+escAttr(style.id)+'" data-button-style-id="'+escAttr(style.id)+'"'+(selected?' checked':'')+'>'+
      '<div class="btn-style-copy"><b>'+esc(style.label)+'</b><p>'+esc(style.summary)+'</p>'+
      '<small><i>Hover:</i> '+esc(style.hover)+'</small><small><i>Best for:</i> '+esc(style.bestFor)+'</small></div>'+
      buttonStylePreviewMarkup(style.id)+
    '</label>';
  }).join('')+'</div>';
}

renderDirection=function(){
  v2EnsureProject(state.project);
  var d=state.project.design,arch=DATA.archetypes[d.archetype]||{};
  var choices=Object.entries(DATA.archetypes).map(function(entry){
    var key=entry[0],a=entry[1];
    return '<button class="choice '+(key===d.archetype?'selected':'')+'" data-archetype="'+key+'"><div class="choice-code">'+key+' · '+esc(a.polarity)+'</div><b>'+esc(a.name)+'</b><p>'+esc((a.notes||a.paletteIntent||'').slice(0,118))+'</p></button>';
  }).join('');
  // One catalogue, shared with the brief reader — so a brief that names a
  // typeface names one this select can actually offer.
  var fonts=fontOptions();
  var activeStyle=v10ActiveStyle();
  return pageHead('02 · Direction','Choose a visual system, then tune it.','Start with a style family and one of its five styles: that sets the palette, the type, all nine dials, how each band is composed and which patterns the builder reaches for. Everything below remains adjustable, and every value is written into the WordPress theme export.',activeStyle?activeStyle.name:(d.archetype+' · '+(arch.name||'Custom')))+
    v10StylePicker({title:'Style family and style'})+
    panel('DST visual archetype','<div class="panel-note">The original thirteen archetypes. They set a starting palette and type pairing only — a style profile from the library above also decides composition, section recipes and pattern preference. Choosing an archetype here clears the concept\'s style reference.</div><div class="choice-grid">'+choices+'</div>','A–M')+
    panel('Palette and type','<div class="panel-note">The five colors become semantic DST tokens: body, text, accent, supporting surface and inverted ground. Corner rounding is now the Corner softness dial below.</div><div class="palette-row">'+[['bg','Canvas'],['ink','Ink'],['accent','Accent'],['soft','Soft'],['dark','Dark']].map(function(x){return '<label class="color-field"><input type="color" data-bind="design.palette.'+x[0]+'" value="'+escAttr(d.palette[x[0]])+'"><span>'+x[1]+'</span></label>'}).join('')+'</div>'+v9PaletteHealth(d)+'<div class="field-grid" style="margin-top:16px">'+field('Body typeface','design.fontBody',d.fontBody,{type:'select',options:fonts})+field('Display typeface','design.fontDisplay',d.fontDisplay,{type:'select',options:fonts})+'</div>')+
    panel('Button family','<div class="panel-note">Choose one system for the primary action, the secondary action and text links. Hover any sample to see exactly what a visitor will see. The choice is applied to every registered button in the preview and the export.</div>'+v3ButtonStylePanel(d),'Primary · Secondary · Link')+
    panel('Quick styles','<div class="panel-note">One click sets every dial below. Start here, then adjust.</div>'+v3PresetButtons(d),String(DIAL_PRESETS.length)+' presets')+
    panel('Design dials',v3DialSample(d)+v3DialGroups(d),'Live system controls')+
    renderEditorNav();
};

/* ---------------------------------------------------------------- *
 * Applying AI output to the project
 * ---------------------------------------------------------------- */

function v3CleanText(value,max){
  return String(value==null?'':value).replace(/\s+/g,' ').trim().slice(0,max||400);
}

/*
 * A testimonial module is a slider, and a slider needs something to slide. Four
 * is the smallest set where the track, the arrows and the progress bar all do
 * something visible, so it is the floor the builder holds the family to.
 */
var TESTIMONIAL_MIN=4;

/** Tops a thinned testimonial set back up to the floor from the family's own copy. */
function v3TestimonialFloor(items){
  var out=(items||[]).slice(),pool=(defaultCopy.testimonial&&defaultCopy.testimonial.items)||[];
  while(out.length<TESTIMONIAL_MIN&&pool.length)out.push(deepClone(pool[out.length%pool.length]));
  return out;
}

/**
 * Maps the brain's neutral `{title, description, value}` item shape onto each
 * family's own content model. The families disagree about field names, and the
 * renderer is the authority on those names, so the translation lives here.
 */
function v3ApplyItems(section,items){
  var list=(items||[]).filter(function(item){return v3CleanText(item&&item.title)||v3CleanText(item&&item.description)});
  if(!list.length)return;
  var family=section.family,content=section.content;
  if(family==='stats'){
    content.items=list.slice(0,6).map(function(item,index){
      var existing=(content.items||[])[index]||{};
      return {value:v3CleanText(item.value,12)||existing.value||String(index+1).padStart(2,'0'),label:v3CleanText(item.title,80),description:v3CleanText(item.description,180)};
    });
    return;
  }
  if(family==='timeline'){
    content.items=list.slice(0,6).map(function(item,index){
      return {value:v3CleanText(item.value,12)||String(index+1).padStart(2,'0'),title:v3CleanText(item.title,120),text:v3CleanText(item.description,260)};
    });
    return;
  }
  if(family==='pricing'){
    content.items=list.slice(0,4).map(function(item,index){
      var existing=(content.items||[])[index]||{};
      return {title:v3CleanText(item.title,80),price:v3CleanText(item.value,40)||existing.price||'On request',text:v3CleanText(item.description,220),features:Array.isArray(existing.features)?existing.features:[]};
    });
    return;
  }
  if(family==='testimonial'){
    // Testimonials render as a slider. A draft that returns one quote used to
    // replace the whole set with a single card, which reads as a broken module:
    // no track to move, no arrows worth pressing, nothing to judge the pattern
    // by. The drafted quotes are written in over the existing ones and the rest
    // of the set is kept, so the module always has enough to slide.
    var kept=v3TestimonialFloor((content.items||[]).slice());
    var drafted=list.slice(0,Math.max(TESTIMONIAL_MIN,kept.length)).map(function(item,index){
      var existing=kept[index]||{};
      return {title:v3CleanText(item.title,80),pretitle:existing.pretitle||'',text:v3CleanText(item.description,420)||existing.text||'',media:existing.media};
    });
    content.items=drafted.concat(kept.slice(drafted.length));
    return;
  }
  if(family==='tabs'){
    content.items=list.slice(0,5).map(function(item,index){
      var existing=(content.items||[])[index]||{};
      return {title:v3CleanText(item.title,60),heading:v3CleanText(item.title,120),body:v3CleanText(item.description,320),bullets:Array.isArray(existing.bullets)?existing.bullets:[],media:existing.media};
    });
    return;
  }
  if(family==='logo'){
    content.logos=list.slice(0,8).map(function(item){return v3CleanText(item.title,28).toUpperCase()}).filter(Boolean);
    return;
  }
  if(family==='contact'){
    content.details=list.slice(0,4).map(function(item,index){
      return {value:v3CleanText(item.value,12)||String(index+1).padStart(2,'0'),title:v3CleanText(item.title,90),text:v3CleanText(item.description,220)};
    });
    return;
  }
  // cards, faq, blog, team, gallery, slider, accordion and haccordion all use
  // the same title/text pair, and media stays whatever the strategist chose.
  var limit=family==='gallery'?6:family==='slider'?5:4;
  content.items=list.slice(0,limit).map(function(item,index){
    var existing=(content.items||[])[index]||{};
    return Object.assign({},existing,{title:v3CleanText(item.title,120),text:v3CleanText(item.description,320)||existing.text||''});
  });
}

function v3ApplyButtons(section,buttons){
  var list=(buttons||[]).filter(function(button){return v3CleanText(button&&button.text)});
  if(!list.length)return;
  var existing=section.content.buttons||[];
  section.content.buttons=list.slice(0,2).map(function(button,index){
    var previous=existing[index]||{};
    return {
      text:v3CleanText(button.text,48),
      // The brain never writes links. Anchors are the builder's business and a
      // guessed URL would break the export.
      link:previous.link||(index===0?'#contact':'#capabilities'),
      btnType:button.type==='secondary'?'secondary':button.type==='link'?'link':(previous.btnType||'primary')
    };
  });
}

/** The footer's three pieces of writing, when the draft carries them. */
function v3ApplyFooterDraft(footer){
  if(!footer)return;
  var target=state.project.footer;
  if(!target)return;
  var statement=v3CleanText(footer.statement,200),
    description=v3CleanText(footer.description,400),
    cta=v3CleanText(footer.ctaText,60);
  if(statement)target.statement=statement;
  if(description)target.description=description;
  if(cta){target.cta=target.cta||{text:'',link:'#contact'};target.cta.text=cta}
}

function v3ApplyContentDraft(draft){
  var sections=state.project.sections.filter(function(section){return section.visible!==false});
  var drafted=(draft&&draft.sections)||[];
  if(!drafted.length)return;
  mutate(function(){
    var cursor=0;
    sections.forEach(function(section){
      // Positional pairing, guarded by family: the server already aligned the
      // draft to the flow, so a mismatch means skip rather than write the wrong
      // copy into the wrong module.
      while(cursor<drafted.length&&drafted[cursor].family!==section.family)cursor+=1;
      var entry=drafted[cursor];
      if(!entry)return;
      cursor+=1;
      var content=section.content=section.content||{};
      if(v3CleanText(entry.pretitle))content.pretitle=v3CleanText(entry.pretitle,80).toUpperCase();
      if(v3CleanText(entry.title))content.title=v3CleanText(entry.title,200);
      if(v3CleanText(entry.subtitle))content.subtitle=v3CleanText(entry.subtitle,400);
      if(v3CleanText(entry.body))content.body=v3CleanText(entry.body,900);
      v3ApplyItems(section,entry.items);
      v3ApplyButtons(section,entry.buttons);
      syncSectionNode(section);
    });
    v3ApplyFooterDraft(draft&&draft.footer);
  },{message:'AI content applied to '+sections.length+' module'+(sections.length===1?'':'s')+((draft&&draft.footer&&v3CleanText(draft.footer.statement))?' and the footer':'')});
}

function v3ApplyCustomFlow(spec){
  var families=(spec&&spec.families||[]).filter(function(family){return DATA.defaultPatternByFamily[family]});
  if(!families.length)return;
  v3EnsureCustomFlows(state.project);
  var index=1,id='X1';
  while(flowExists(id,state.project)){index+=1;id='X'+index}
  var flow={
    id:id,
    name:v3CleanText(spec.name,60)||'Custom outline',
    tagline:v3CleanText(spec.rationale,140)||'A sequence written by the strategist',
    bestFor:'This page only. Built from a typed outline and mapped to registered DST sections.',
    avoid:'',
    families:families,
    rhythm:'Order chosen by the strategist; every step resolves to a registered DST pattern.',
    custom:true
  };
  state.project.customFlows.push(flow);
  // The project owns it. Nothing is added to the catalogue.
  applyFlow(id);
}

/* ---------------------------------------------------------------- *
 * Steps 01 and 03 — the Brief Brain panels
 * ---------------------------------------------------------------- */

/**
 * The archetype catalog, with each archetype's palette attached.
 *
 * `DATA.archetypes` describes character and `DATA.archetypeStyles` holds the
 * colours, and the brain only ever saw the first half. That is the whole reason
 * a brief could ask for green and white and get back three variations of
 * whatever thirteen fixed palettes happened to contain: nothing in the loop knew
 * what a palette was, so nothing could design one.
 */
function v9ArchetypeCatalog(){
  var out={};
  Object.keys(DATA.archetypes||{}).forEach(function(key){
    var style=(DATA.archetypeStyles||{})[key]||{};
    out[key]={...DATA.archetypes[key],palette:{bg:style.bg,ink:style.ink,accent:style.accent,soft:style.soft,dark:style.dark}};
  });
  return out;
}

function v3BrainContext(){
  return {
    state:state,
    project:state.project,
    // The palettes travel with the archetypes now: the brain designs colour from
    // the brief, and it cannot judge "different from the others" or "close to
    // what this archetype already is" without seeing what they currently are.
    archetypes:v9ArchetypeCatalog(),
    flows:allFlows(),
    mutate:mutate,
    queueSave:queueSave,
    queuePreview:queuePreview,
    renderAll:renderAll,
    announce:announce,
    applyArchetype:function(key){applyArchetype(key)},
    applyFlow:function(id){applyFlow(id)},
    applyContentDraft:v3ApplyContentDraft,
    applyCustomFlow:v3ApplyCustomFlow
  };
}

function v3BrainPanel(render){
  if(typeof render!=='function')return '';
  try{return render(v3BrainContext())}catch(error){console.error('Brief Brain panel failed',error);return ''}
}

var renderBriefBeforeV3=renderBrief;
renderBrief=function(){
  var output=renderBriefBeforeV3(),nav=renderEditorNav();
  var brain=v3BrainPanel(briefBrainFeature.renderBriefBrainPanel);
  return nav&&output.slice(-nav.length)===nav?output.slice(0,-nav.length)+brain+nav:output+brain;
};

var renderFlowBeforeV3=renderFlow;
renderFlow=function(){
  v2EnsureProject(state.project);
  var output=renderFlowBeforeV3(),nav=renderEditorNav();
  var brain=v3BrainPanel(briefBrainFeature.renderFlowBrainPanel);
  return nav&&output.slice(-nav.length)===nav?brain+output.slice(0,-nav.length)+nav:brain+output;
};

['input','change','click'].forEach(function(type){
  byId('editorInner').addEventListener(type,function(event){
    if(typeof briefBrainFeature.handleBriefBrainEvent==='function'&&briefBrainFeature.handleBriefBrainEvent(event,v3BrainContext())){
      event.stopPropagation();
    }
  },true);
});

/* ---------------------------------------------------------------- *
 * Step 04 — Simple and Extended module views
 * ---------------------------------------------------------------- */

var VIEWPORT_EFFECT_LABELS=[
  {value:'',label:'No movement'},
  {value:'fade',label:'Fade in gently'},
  {value:'fade-up',label:'Rise up as it arrives'},
  {value:'fade-down',label:'Drop down as it arrives'},
  {value:'fade-right',label:'Slide in from the left'},
  {value:'fade-left',label:'Slide in from the right'},
  {value:'zoom-in',label:'Grow into place'},
  {value:'animate-headings',label:'Headline first, then the rest'}
];

function v3SimpleLayoutEditor(section){
  ensureSectionSettings(section);
  var fidelity=fidelityEnsureSection(section),layout=section.layout,effects=section.effects;
  var motifs=Object.keys(DATA.decorations).sort();
  var spacing=[{value:'none',label:'None'},{value:'small',label:'A little'},{value:'default',label:'Normal'},{value:'large',label:'Generous'}];
  var columns=fidelity&&fidelity.cards?fidelity.cards.desktop:null;

  var look=fidelityGroup('How this section looks','The four choices that change the most, with nothing to type.',
    field('Background','setting.'+section.id+'.inverted',String(layout.inverted),{type:'select',options:[{value:'false',label:'Light background'},{value:'true',label:'Dark background'}]})+
    field('Content width','setting.'+section.id+'.container',layout.container,{type:'select',options:[{value:'alt',label:'Narrow — one column of reading'},{value:'default',label:'Standard'},{value:'wide',label:'Wide'},{value:'full',label:'Edge to edge'}]})+
    field('Space above','setting.'+section.id+'.paddingTop',layout.paddingTop,{type:'select',options:spacing})+
    field('Space below','setting.'+section.id+'.paddingBottom',layout.paddingBottom,{type:'select',options:spacing})
  );

  // The overlay controls belong here and not only in Extended view: a hero whose
  // headline has disappeared into a bright photograph is the most common thing
  // to want to fix, and the simple builder is where most people are standing.
  var surface=fidelitySurfaceGroup(section,fidelity);

  var grid=columns==null?'':fidelityGroup('How many across','Only affects sections that repeat items, such as cards and services.',
    rangeField('Items per row on desktop','fidelity.'+section.id+'.cards.desktop',columns,{min:1,max:6,step:1,fallback:3,help:'Tablet and phone counts adapt automatically. Set them by hand in the Extended view.'})
  );

  var movement=fidelityGroup('How it arrives','What happens when the visitor scrolls this section into view. The overall speed comes from the Movement dial in Step 02.',
    field('Arrival effect','effect.'+section.id+'.viewport',effects.viewport||'',{type:'select',full:true,options:VIEWPORT_EFFECT_LABELS})
  );

  var decoration=fidelityGroup('Decorative pattern','An optional registered background motif. It always sits behind the content and is clipped to the section.',
    field('Pattern','decoration.'+section.id+'.motif',section.decoration&&section.decoration.motif||'',{type:'select',options:[{value:'',label:'None'}].concat(motifs.map(function(motif){return {value:motif,label:motif.replace(/-/g,' ')}}))})+
    field('Where it sits','decoration.'+section.id+'.position',section.decoration&&section.decoration.position||'cover',{type:'select',options:[{value:'cover',label:'Across the whole section'},{value:'top-left',label:'Top left'},{value:'top-right',label:'Top right'},{value:'bottom-left',label:'Bottom left'},{value:'bottom-right',label:'Bottom right'},{value:'center',label:'Centred'},{value:'top',label:'Along the top'},{value:'bottom',label:'Along the bottom'}]})+
    rangeField('How strong it is','decoration.'+section.id+'.opacity',section.decoration&&section.decoration.opacity||.04,{scale:100,min:0,max:100,step:1,fallback:.04,full:false})+
    rangeField('How big it is','decoration.'+section.id+'.scale',section.decoration&&section.decoration.scale||1,{scale:100,min:25,max:300,step:5,fallback:1,display:'%',full:false})
  );

  return look+surface+grid+movement+decoration+
    '<div class="panel-note view-note">This is the Simple view. Everything here is safe to change and cannot break the layout. Switch to <b>Extended</b> for padding, per-breakpoint columns, card and list geometry, and scroll-driven effects.</div>';
}

var renderLayoutEditorExtended=renderLayoutEditor;
renderLayoutEditor=function(section){
  return state.moduleView==='extended'
    ? renderLayoutEditorExtended(section)
    : v3SimpleLayoutEditor(section);
};

var renderModulesBeforeV3=renderModules;
renderModules=function(){
  var simple=state.moduleView!=='extended';
  var toggle='<div class="view-switch" role="group" aria-label="Module editor detail level">'+
    '<div class="view-switch-copy"><b>'+(simple?'Basic view':'Extended view')+'</b><span>'+(simple?'The choices a strategist needs, in plain language.':'Every registered DST attribute this builder can set.')+'</span></div>'+
    '<div class="segmented view-switch-control">'+
      '<button class="'+(simple?'active':'')+'" data-module-view="simple" aria-pressed="'+(simple?'true':'false')+'">Basic</button>'+
      '<button class="'+(simple?'':'active')+'" data-module-view="extended" aria-pressed="'+(simple?'false':'true')+'">Extended</button>'+
    '</div></div>';
  var output=renderModulesBeforeV3();
  // The switch belongs directly under the step heading and above the first
  // panel, because it changes what every panel below it contains.
  var boundary=output.indexOf('<section class="panel"');
  return boundary<0?toggle+output:output.slice(0,boundary)+toggle+output.slice(boundary);
};

byId('editorInner').addEventListener('click',function(event){
  var trigger=event.target.closest('[data-module-view]');
  if(!trigger)return;
  state.moduleView=trigger.dataset.moduleView==='extended'?'extended':'simple';
  queueSave();
  renderEditor();
  announce(state.moduleView==='extended'?'Extended view — every DST attribute':'Basic view — the simple choices only');
});

/* ---------------------------------------------------------------- *
 * Dial and button-style bindings
 * ---------------------------------------------------------------- */

var updateBindingBeforeV3=updateBinding;
updateBinding=function(path,value,input){
  var result=updateBindingBeforeV3(path,value,input);
  var dialMatch=String(path||'').match(/^design\.([a-zA-Z]+)$/);
  if(dialMatch&&DIAL_KEYS.indexOf(dialMatch[1])>=0){
    var design=state.project.design;
    design[dialMatch[1]]=Math.max(0,Math.min(100,Math.round(Number(value)||0)));
    ensureDials(design);
    var output=document.querySelector('[data-dial-output="'+dialMatch[1]+'"]');
    if(output)output.textContent=dialLabel(dialMatch[1],design[dialMatch[1]]);
    // The sample block and the button swatches read dial tokens through inline
    // custom properties, so refresh them without re-rendering the whole step.
    v3RefreshDialSurfaces();
    queueSave();
    queuePreview();
  }
  return result;
};

function v3RefreshDialSurfaces(){
  var design=state.project.design,tokens=dialTokens(design);
  var sample=document.querySelector('.dial-sample');
  if(sample){
    sample.style.setProperty('--sample-gap',tokens.gridGap);
    sample.style.setProperty('--sample-pad',tokens.cardPadding);
    sample.style.setProperty('--sample-radius',tokens.radius);
    sample.style.setProperty('--sample-lift',tokens.hoverLift);
    sample.style.setProperty('--sample-duration',tokens.motionDuration);
    sample.style.setProperty('--sample-ease',tokens.motionEase);
    sample.style.setProperty('--sample-border',tokens.borderAlpha);
    sample.style.setProperty('--sample-shadow',tokens.cardShadow);
    sample.style.setProperty('--sample-lh',tokens.bodyLineHeight);
    sample.style.setProperty('--sample-scale',tokens.typeScale);
    sample.style.setProperty('--sample-tracking',tokens.titleTracking);
    sample.style.setProperty('--sample-distance',tokens.motionDistance);
    sample.style.setProperty('--sample-measure',tokens.measure);
    sample.style.setProperty('--sample-stagger',tokens.motionStagger);
    sample.style.setProperty('--sample-motion-scale',tokens.motionScale);
    sample.style.setProperty('--sample-accent-rule',tokens.accentRule);
  }
  var swatches=document.querySelector('.btn-style-list');
  if(swatches){
    swatches.style.setProperty('--dst--default-radius',tokens.radius);
    swatches.style.setProperty('--sbs-motion-duration',tokens.motionDuration);
    swatches.style.setProperty('--sbs-motion-ease',tokens.motionEase);
    swatches.style.setProperty('--sbs-hover-lift',tokens.hoverLift);
    swatches.style.setProperty('--sbs-border-width',tokens.borderWidth);
    swatches.style.setProperty('--sbs-accent-rule',tokens.accentRule);
  }
  var presets=document.querySelector('.preset-grid');
  if(presets){
    var active=v3PresetMatch(design);
    presets.querySelectorAll('[data-dial-preset]').forEach(function(button){
      button.classList.toggle('is-active',button.dataset.dialPreset===active);
    });
  }
}

byId('editorInner').addEventListener('change',function(event){
  var radio=event.target.closest('[data-button-style-id]');
  if(!radio)return;
  mutate(function(){state.project.design.buttonStyle=normalizeButtonStyle(radio.dataset.buttonStyleId)},{render:false,message:'Button family: '+buttonStyle(radio.dataset.buttonStyleId).label});
  document.querySelectorAll('.btn-style-card').forEach(function(card){
    card.classList.toggle('is-selected',card.contains(radio));
  });
});

byId('editorInner').addEventListener('click',function(event){
  var trigger=event.target.closest('[data-dial-preset]');
  if(!trigger)return;
  var preset=DIAL_PRESETS.find(function(entry){return entry.id===trigger.dataset.dialPreset});
  if(!preset)return;
  mutate(function(){
    Object.keys(preset.values).forEach(function(key){state.project.design[key]=preset.values[key]});
    ensureDials(state.project.design);
  },{message:'Quick style: '+preset.label});
});

/* ---------------------------------------------------------------- *
 * Hero fit
 * ---------------------------------------------------------------- */

/*
 * Two corrections to the hero banner, both caused by the hero's editorial
 * width caps being applied without regard to what is actually inside the inner.
 *
 * 1. A hero whose heading is centred kept a left-aligned inner. The text
 *    centred itself inside a box that was still pinned to the left edge, so a
 *    "centred" hero read as slightly off-centre on every wide screen.
 * 2. A hero built from a two-column layout — `l-content-2`, or a `ds-columns`
 *    row — inherited the single-column cap of `min(74rem, 56vw)`. Two columns
 *    inside that cap squeeze the copy and the image into roughly a third of the
 *    page each. Those heroes fall back to the authored `--cw` instead, so an
 *    intentional `contentWidth` is still honoured and only the hero's own
 *    editorial cap is dropped.
 *
 * `:has()` is used deliberately: the correction depends on the composition of
 * the pattern, which the renderer does not otherwise expose as a class, and it
 * keeps the preview and the exported standalone HTML identical.
 */
function v3HeroFitCss(){
  var MULTI_COLUMN=['.dst-content2','.ds-row','.dst-cards__grid'];
  var relaxed=MULTI_COLUMN.map(function(selector){return '#sbs-site .dst-banner__inner:has(> '+selector+'),#sbs-site .dst-banner__inner:has(> * > '+selector+')'}).join(',');
  return '\n'+
    /* 1 — centre (or right-align) the inner to match its own heading. */
    '#sbs-site .dst-banner__inner:has(> .c-heading.text-center),#sbs-site .dst-banner__inner:has(> .c-heading.-center),#sbs-site .dst-banner__container.align-center>.dst-banner__inner{margin-inline:auto}\n'+
    '#sbs-site .dst-banner__inner:has(> .c-heading.text-right),#sbs-site .dst-banner__container.align-right>.dst-banner__inner{margin-left:auto;margin-right:0}\n'+
    '@media(max-width:680px){#sbs-site .dst-banner__inner:has(> .c-heading.text-center-mobile),#sbs-site .dst-banner__container.align-center-mobile>.dst-banner__inner{margin-inline:auto}}\n'+
    /* 2 — a multi-column hero uses the authored width, not the hero cap. */
    relaxed+'{max-width:var(--cw,100%)}\n'+
    /* The 20ch display measure is a single-column device; inside a column it
       would break a two-word line into four. */
    '#sbs-site .dst-content2 .c-heading__title,#sbs-site .ds-column .c-heading__title{max-width:24ch}\n'+
    '#sbs-site .dst-content2 .c-heading__sub,#sbs-site .ds-column .c-heading__sub{max-width:var(--sbs-measure)}\n';
}

/* ---------------------------------------------------------------- *
 * Component fit
 * ---------------------------------------------------------------- */

/*
 * Corrections to registered components whose CSS did not survive contact with
 * the real block markup.
 *
 * The card media overlay is the important one. `dst-shared.css` carries both
 *
 *   .dst-card--media-background > *:not(.c-block__media){position:relative}
 *   .c-block__scrim{position:absolute;inset:0;z-index:1}
 *
 * and the first selector is more specific (two classes against one), so the
 * scrim lost `position:absolute`, collapsed to zero height in normal flow, and
 * every media-background card rendered with no overlay at all — which is why
 * white card titles sat directly on a photograph. Re-stating the scrim's own
 * geometry from inside `#sbs-site` settles it without touching the shared
 * stylesheet that the WordPress theme also ships.
 */
function v3ComponentFitCss(){
  return '\n'+
    /* --- Card media overlay: geometry and stacking order --- */
    '#sbs-site .c-block__scrim{position:absolute;inset:0;z-index:1;pointer-events:none}\n'+
    '#sbs-site .dst-card--media-background>.c-block__media{position:absolute;inset:0;z-index:0}\n'+
    '#sbs-site .dst-card--media-background>.c-block__body{position:absolute;z-index:2}\n'+
    '#sbs-site .dst-card--media-background{isolation:isolate;overflow:hidden}\n'+
    /* The scrim is the readability guarantee, so it must survive a card that
       carries no explicit overlay of its own. */
    '#sbs-site .dst-card--media-background>.c-block__scrim:empty{background:var(--card-scrim,linear-gradient(180deg,rgba(7,28,42,.05) 0%,rgba(7,28,42,.88) 78%))}\n'+
    /* --- Accordion open/close animation --- */
    /* Native <details> does not animate. `::details-content` plus an
       interpolatable `auto` is the whole mechanism; a browser without either
       drops these rules and the accordion still opens, just instantly. */
    '#sbs-site{interpolate-size:allow-keywords}\n'+
    '#sbs-site .dst-accordion__item::details-content{block-size:0;overflow:hidden;opacity:0;transition:block-size var(--sbs-accordion-dur) var(--sbs-motion-ease),opacity var(--sbs-accordion-dur) var(--sbs-motion-ease),content-visibility var(--sbs-accordion-dur) allow-discrete}\n'+
    '#sbs-site .dst-accordion__item[open]::details-content{block-size:auto;opacity:1}\n'+
    '#sbs-site .dst-accordion__q{transition:color var(--sbs-accordion-dur) var(--sbs-motion-ease)}\n'+
    '#sbs-site .dst-accordion__ar{transition:transform var(--sbs-accordion-dur) var(--sbs-motion-ease)}\n'+
    /* The horizontal accordion already animates its flex basis; keep it on the
       same dial so the two devices never disagree about speed. */
    '#sbs-site .sbs-hacc-item{transition:flex var(--sbs-hacc-dur) var(--sbs-motion-ease)}\n'+
    '@media(prefers-reduced-motion:reduce){#sbs-site .dst-accordion__item::details-content,#sbs-site .dst-accordion__ar,#sbs-site .sbs-hacc-item{transition:none}}\n'+
    /* --- Editor-only: marks the module the strategist just selected. Nothing
       in an exported page ever carries this attribute, so the rule is inert
       there; it lives here so the preview and the export share one stylesheet
       rather than the editor injecting styles into the frame. --- */
    '#sbs-site [data-preview-focus]{position:relative}\n'+
    '#sbs-site [data-preview-focus]:after{content:"";position:absolute;inset:0;z-index:40;pointer-events:none;box-shadow:inset 0 0 0 3px color-mix(in srgb,var(--dst--primary-color2) 85%,transparent);animation:sbs-focus-fade 1.6s ease forwards}\n'+
    '@keyframes sbs-focus-fade{0%{opacity:0}12%{opacity:1}70%{opacity:1}100%{opacity:0}}\n'+
    '@media(prefers-reduced-motion:reduce){#sbs-site [data-preview-focus]:after{animation:none;opacity:.9}}\n';
}

/*
 * A disclosure that opens instantly reads as a page reload, so the accordion
 * keeps a floor even when the Movement dial is low. It still honours zero:
 * "Still" means still.
 */
function v3AccordionDurations(design){
  var motion=clamp(Number(design.motion)||0,0,100)/100;
  if(motion<0.05)return '#sbs-site.ver{--sbs-accordion-dur:0s;--sbs-hacc-dur:0s}\n';
  return '#sbs-site.ver{--sbs-accordion-dur:'+(0.26+0.24*motion).toFixed(2)+'s;--sbs-hacc-dur:'+(0.38+0.34*motion).toFixed(2)+'s}\n';
}

/* ---------------------------------------------------------------- *
 * Per-family defaults
 * ---------------------------------------------------------------- */

/*
 * Starting points that a strategist should never have to set by hand. Each is
 * applied exactly once per section and recorded, so a later edit in Extended
 * view is never silently reverted on the next render.
 */
/**
 * Copy over a photograph needs a wash. All of it, not two families.
 *
 * This used to be a list — hero and cta — and the audit of all 154 patterns said
 * that was wrong for nineteen of them: six team bands, six card bands, two FAQ
 * bands, two timelines, a text band and a testimonial all paint a photograph
 * behind their copy and painted nothing over it. Whatever the picture happens to
 * be doing behind the words, the type has to hold.
 *
 * So the rule is now the condition itself: if a section paints a photograph and
 * is not already painting a wash over it, it gets the default one — the brand's
 * own dark at 60%, which is the strength at which the wash *is* the ground and
 * the copy inverts to suit.
 */
var BANNER_OVERLAY_STRENGTH=0.6;
/* Below this, a scrim is a tint over a photograph and the photo is still the
   ground; at or above it the scrim *is* the ground and decides the text tone. */
var BANNER_SCRIM_GROUND_STRENGTH=0.6;

/**
 * The node this section actually paints a photograph on, at any depth.
 *
 * Mirrors the renderer exactly: a wrapper paints only what its own
 * `backgroundImage` names, while a banner falls back to the section's first
 * media — which is why a hero needs no authored background to have one.
 */
function v3PhotoNode(section){
  if(!section||!section.node)return null;
  var found=null;
  (function walk(node){
    if(found||!node||typeof node!=='object')return;
    var attrs=node.attributes||{},raw=attrs.backgroundImage,
      named=Array.isArray(raw)?raw.length>0:!!(raw&&(raw.src||raw.url||raw.id));
    if(named||(node.component==='ds-blocks/dst-banner'&&mediaChoice(section,0))){found=node;return}
    (node.children||[]).forEach(walk);
  })(section.node);
  return found;
}

/** The wash a photograph gets when the pattern did not paint one itself. */
function v3DefaultScrim(){return fidelityRgba(state.project.design.palette.dark,1)}

/**
 * True when this surface is already painting a wash of its own.
 *
 * A colour with the flag off is not a wash — it is a value the pattern carries
 * and does not use, and three of the unreadable bands were exactly that.
 */
function v3PaintsScrim(settings){
  return !!(settings&&settings.overlayEnabled&&cleanText(settings.overlay));
}

function v3SectionDefaults(section){
  var fidelity=section&&section.fidelity;
  if(!fidelity)return;
  fidelity.defaults=fidelity.defaults&&typeof fidelity.defaults==='object'?fidelity.defaults:{};
  var applied=fidelity.defaults,items=(section.content&&section.content.items||[]).length;

  // A four-up grid is the SBS house default. Capped by the item count so three
  // cards never leave a hole where a fourth should be.
  if(fidelity.cards&&!applied.cardGrid&&section.family==='cards'){
    fidelity.cards.desktop=Math.max(2,Math.min(4,items||4));
    fidelity.cards.tablet=Math.min(2,fidelity.cards.desktop);
    fidelity.cards.mobile=1;
    applied.cardGrid=true;
  }

  // A logo band is a proof strip, not a list: it has to read as one row.
  if(fidelity.list&&!applied.logoGrid&&section.family==='logo'){
    var logos=(section.content&&section.content.logos||[]).length||items||6;
    fidelity.list.desktop=Math.max(3,Math.min(6,logos));
    fidelity.list.tablet=Math.min(4,fidelity.list.desktop);
    fidelity.list.mobile=Math.min(2,fidelity.list.desktop);
    applied.logoGrid=true;
  }

  // Any band that paints a photograph behind its copy. Whatever the picture
  // happens to be doing there — a bright sky, a white wall, a busy crowd — the
  // type has to hold, so it starts with a readable wash instead of whatever
  // contrast the crop happened to give. A pattern that paints its own wash keeps
  // it: this only fills a blank.
  if(fidelity.surface&&!applied.photoScrim&&!applied.bannerOverlay){
    var photo=v3PhotoNode(section);
    if(photo){
      var onSurface=v3IsSurfaceNode(section,fidelity,photo);
      if(!v3PaintsScrim(onSurface?fidelity.surface:v3NodeScrim(photo))){
        // The colour is opaque and the strength carries the 60%, because that is
        // the split the overlay control shows: a solid overlay is always written
        // at full alpha and "Overlay strength" is the slider people reach for.
        var scrim=v3DefaultScrim();
        if(onSurface){
          fidelity.surface.overlayEnabled=true;
          fidelity.surface.overlay=scrim;
          fidelity.surface.overlayOpacity=BANNER_OVERLAY_STRENGTH;
          fidelity.surface.gradientStartOpacity=1;
          fidelity.surface.gradientEndOpacity=1;
        }else{
          // The photograph is not on the node the surface control edits — a FAQ
          // band paints it three levels down — so the wash is written where the
          // renderer will actually read it.
          photo.attributes=photo.attributes||{};
          photo.attributes.backgroundOverlayEnabled=true;
          photo.attributes.backgroundOverlay=scrim;
          photo.attributes.backgroundOverlayOpacity=BANNER_OVERLAY_STRENGTH;
        }
        // Recorded so a later brand change can move a wash nobody has edited,
        // and so an edited one is never moved.
        applied.photoScrimColor=scrim;
      }
      v3ToneFromScrim(section,fidelity,photo);
      applied.photoScrim=true;
    }
  }
  v3RefreshPhotoScrim(section,fidelity,applied);
}

/** The overlay settings as they exist on one node, in fidelity's own shape. */
function v3NodeScrim(node){
  var attrs=(node&&node.attributes)||{};
  return {overlayEnabled:attrs.backgroundOverlayEnabled,overlay:attrs.backgroundOverlay,overlayOpacity:attrs.backgroundOverlayOpacity};
}

/** True when the photograph sits on the very node the surface control edits. */
function v3IsSurfaceNode(section,fidelity,photo){
  if(!photo)return false;
  var surface=fidelityTarget(section,fidelity.surface,FIDELITY_SURFACE_COMPONENTS)||section.node;
  return !!surface&&surface===photo;
}

/**
 * A default wash follows the brand.
 *
 * The wash is the brand's dark, so switching style or editing the palette has to
 * move it — otherwise a page restyled from navy to forest keeps a navy scrim over
 * every photograph. Only a wash this code wrote and nobody has touched since is
 * moved; the moment somebody edits it, the recorded colour stops matching and it
 * is left alone for good.
 */
function v3RefreshPhotoScrim(section,fidelity,applied){
  var previous=applied.photoScrimColor;
  if(!previous)return;
  var scrim=v3DefaultScrim();
  if(scrim===previous)return;
  var photo=v3PhotoNode(section);
  if(!photo)return;
  if(v3IsSurfaceNode(section,fidelity,photo)){
    if(cleanText(fidelity.surface.overlay)!==previous)return;
    fidelity.surface.overlay=scrim;
  }else{
    var attrs=photo.attributes||{};
    if(cleanText(attrs.backgroundOverlay)!==previous)return;
    attrs.backgroundOverlay=scrim;
  }
  applied.photoScrimColor=scrim;
  v3ToneFromScrim(section,fidelity,photo);
}

/**
 * A banner's tone follows the scrim it actually has.
 *
 * The family preset says a hero is a dark section, which is true of almost every
 * hero and wrong for the handful that wash a *pale* colour across the picture —
 * p89 v3 lays #E3F8FF over the left 60% and puts the headline in it, p5 v4 fades
 * to near-white. Those shipped as white type on white, which is not a subtle
 * contrast failure but an invisible headline.
 *
 * Only an opaque scrim gets a vote. A 27% tint over a photograph is a tint, and
 * the ground underneath it is still the photograph, so the preset stands.
 */
function v3ToneFromScrim(section,fidelity,photo){
  var onSurface=!photo||v3IsSurfaceNode(section,fidelity,photo),
    settings=onSurface?fidelity.surface:v3NodeScrim(photo);
  if(!settings||!settings.overlayEnabled)return;
  var strength=fidelityOpacity(settings.overlayOpacity,.5);
  // Below this the wash is a tint and the photograph is still the ground; at or
  // above it the wash *is* the ground and decides the text tone.
  if(strength<BANNER_SCRIM_GROUND_STRENGTH)return;
  var tone=v2SurfaceTone(settings.overlay,state.project);
  if(tone==null||tone===!!section.layout.inverted)return;
  section.layout.inverted=tone;
  // The mirrored background colour was written from the preset tone, so it has
  // to move with it or a light section keeps painting itself dark underneath.
  if(onSurface)fidelity.surface.backgroundColor=tone?fidelityRgba(state.project.design.palette.dark,1):'';
}

var ensureSectionSettingsBeforeV3=ensureSectionSettings;
ensureSectionSettings=function(section){
  var result=ensureSectionSettingsBeforeV3(section);
  v3SectionDefaults(section);
  return result;
};

/* ---------------------------------------------------------------- *
 * Preview follows the selected module
 * ---------------------------------------------------------------- */

var v3PreviewFocusId='';

/**
 * Scrolls the preview to a section and marks it briefly. Selecting a module in
 * a list of nine is meaningless if the preview stays where it was.
 */
function v3FocusPreviewSection(sectionId,{smooth=true}={}){
  if(!sectionId)return false;
  try{
    var frame=byId('sitePreview'),view=frame&&frame.contentWindow,doc=frame&&frame.contentDocument;
    if(!view||!doc)return false;
    var target=doc.getElementById(sectionId);
    if(!target)return false;
    var header=doc.querySelector('.site-header'),
      offset=header?header.getBoundingClientRect().height:0,
      top=Math.max(0,target.getBoundingClientRect().top+view.scrollY-offset-12),
      reduced=view.matchMedia&&view.matchMedia('(prefers-reduced-motion: reduce)').matches,
      still=(Number(state.project.design.motion)||0)<5;
    // `auto` is not "instant": it defers to the document's own
    // `scroll-behavior`, which this page sets to smooth — so the movement-off
    // path was animating too, and every jump was cancellable.
    view.scrollTo({top:top,behavior:smooth&&!reduced&&!still?'smooth':'instant'});
    /*
     * A smooth scroll is a request, not a result. The stage re-fits the frame
     * whenever the step changes or the shell is rescaled, and resizing an iframe
     * mid-animation cancels the scroll outright — so selecting a module within a
     * beat of switching step left the preview exactly where it was, silently.
     * One verification, and if the scroll did not land it is made immediately.
     */
    var wasAt=view.scrollY;
    clearTimeout(v3FocusPreviewSection.settle);
    v3FocusPreviewSection.settle=setTimeout(function(){
      try{
        // Only when the animation never started: still exactly where it was, and
        // that is not where it was asked to go. Anything else — including the
        // reader having scrolled somewhere themselves in the meantime — is left
        // alone, because this must not fight a person's own scrolling.
        if(Math.abs(view.scrollY-wasAt)>2)return;
        if(Math.abs(view.scrollY-top)<=8)return;
        if(doc.getElementById(sectionId))view.scrollTo({top:top,behavior:'instant'});
      }catch(error){}
    },260);
    doc.querySelectorAll('[data-preview-focus]').forEach(function(node){node.removeAttribute('data-preview-focus')});
    target.setAttribute('data-preview-focus','true');
    clearTimeout(v3FocusPreviewSection.timer);
    v3FocusPreviewSection.timer=setTimeout(function(){
      try{target.removeAttribute('data-preview-focus')}catch(error){}
    },1600);
    return true;
  }catch(error){return false}
}

/**
 * Focuses a section, deferring to the next preview rebuild only if the frame is
 * not ready yet.
 *
 * The pending id is a strict one-shot. An earlier version left it set after a
 * successful scroll, and it then hijacked the *next* unrelated rebuild — a live
 * setting change would silently jump the preview back to the last selected
 * module instead of holding the reader's scroll position.
 */
function v3QueuePreviewFocus(sectionId){
  v3PreviewFocusId='';
  if(!sectionId)return;
  if(v3FocusPreviewSection(sectionId))return;
  // The frame is mid-rebuild; renderPreview's load handler picks it up, and the
  // deadline stops a never-arriving rebuild from leaving it armed.
  v3PreviewFocusId=sectionId;
  clearTimeout(v3QueuePreviewFocus.timer);
  v3QueuePreviewFocus.timer=setTimeout(function(){
    if(v3PreviewFocusId!==sectionId)return;
    v3PreviewFocusId='';
    v3FocusPreviewSection(sectionId);
  },400);
}

var renderPreviewBeforeV3=renderPreview;
renderPreview=function(){
  var pending=v3PreviewFocusId;
  renderPreviewBeforeV3();
  if(!pending)return;
  // Consumed here: whatever happens on load, this rebuild is the only one that
  // may act on it.
  v3PreviewFocusId='';
  var frame=byId('sitePreview');
  frame.addEventListener('load',function once(){
    frame.removeEventListener('load',once);
    // No smooth scroll on a rebuild: the document is new, so an animated jump
    // from the top would read as the page reloading itself.
    setTimeout(function(){v3FocusPreviewSection(pending,{smooth:false})},140);
  });
};

// Both module lists (Step 03's sequence and Step 04's picker) use the same row.
byId('editorInner').addEventListener('click',function(event){
  var row=event.target.closest('.module-row[data-section-id]');
  if(!row||event.target.closest('button'))return;
  v3QueuePreviewFocus(row.dataset.sectionId);
},true);

/* ---------------------------------------------------------------- *
 * Preview stage fit
 * ---------------------------------------------------------------- */

var DEVICE_WIDTHS={desktop:1440,tablet:820,mobile:390};
// The tablet and phone bezels are drawn outside the shell's border box, so the
// zoom has to leave room for them or the frame is clipped at the stage edge.
var DEVICE_BEZEL={desktop:0,tablet:42,mobile:34};

/**
 * Makes the emulated viewport as tall as the stage can actually show.
 *
 * The frame used to be sized from `calc(100vh - 150px)`, a guess at the chrome
 * above it that ignored the zoom entirely — so a shell drawn at 81% ended well
 * short of the stage floor and left a band of empty canvas. The frame is laid
 * out *before* `zoom` scales it, so the height that lands exactly on the stage's
 * inner edge is the inner height divided by the zoom. Measuring the stage's own
 * padding keeps the gap under the device identical to the one above and beside
 * it, whatever the padding is set to.
 */
function v3FitPreviewHeight(){
  var stage=document.querySelector('.preview-stage'),frame=byId('sitePreview'),shell=byId('deviceShell');
  if(!stage||!frame)return;
  var styles=getComputedStyle(stage),
    inner=stage.clientHeight-(parseFloat(styles.paddingTop)||0)-(parseFloat(styles.paddingBottom)||0),
    zoom=state.zoom||1,
    // The phone and tablet bezels are painted outside the shell's box, so the
    // frame has to give the ring below it room or it sits on the stage edge.
    height=Math.max(420,Math.round((inner-(DEVICE_BEZEL[state.device]||0))/zoom));
  // The stylesheet floors both of these for the no-script case; inline zeroes
  // stop those floors overriding a measured fit in a short window.
  if(shell)shell.style.minHeight='0';
  frame.style.minHeight='0';
  frame.style.height=height+'px';
}

var updateDeviceBeforeV3=updateDevice;
updateDevice=function(){
  var stage=document.querySelector('.preview-stage'),width=DEVICE_WIDTHS[state.device]||DEVICE_WIDTHS.desktop;
  if(stage&&!state.zoom){
    var styles=getComputedStyle(stage),
      inner=stage.clientWidth-(parseFloat(styles.paddingLeft)||0)-(parseFloat(styles.paddingRight)||0);
    // Measured from the real stage padding rather than a hard-coded allowance,
    // so the emulated viewport is exactly the device width and never a few
    // pixels narrower because a flex item was allowed to shrink.
    state.zoom=clamp((inner-(DEVICE_BEZEL[state.device]||0))/width,.3,1);
  }
  var result=updateDeviceBeforeV3();
  v3FitPreviewHeight();
  return result;
};

// The zoom itself is left alone on resize — it may be the strategist's own
// choice from the ± buttons — but the height it fits into has just changed.
window.addEventListener('resize',v3FitPreviewHeight);

/* ---------------------------------------------------------------- *
 * Step 05 — extra preflight checks
 * ---------------------------------------------------------------- */

var validateProjectBeforeV3=validateProject;
validateProject=function(){
  var base=validateProjectBeforeV3(),project=state.project,design=project.design;
  v3EnsureDesign(project);
  var sections=project.sections.filter(function(section){return section.visible!==false});
  var checks=base.checks.slice();
  var brain=project.brain||{};
  var tokens=dialTokens(design),levels=dialLevels(design);

  function push(status,title,detail,code){checks.push({status:status,title:title,detail:detail,code:code})}

  // Content quality the strategist can act on.
  var placeholders=[];
  sections.forEach(function(section){
    var content=section.content||{};
    var text=[content.title,content.subtitle,content.body].concat((content.items||[]).map(function(item){return [item&&item.title,item&&item.text,item&&item.description].join(' ')})).join(' ');
    if(/lorem ipsum|replace with|add a real|placeholder|demonstration|tbc|tbd|xxx/i.test(text))placeholders.push(section.id);
  });
  push(placeholders.length?'warn':'pass','Copy is real, not placeholder',
    placeholders.length?placeholders.length+' module'+(placeholders.length===1?'':'s')+' still contain draft instructions or demonstration copy.':'No placeholder instructions remain in the page copy.','COPY');

  var longTitles=sections.filter(function(section){return cleanText(section.content&&section.content.title).length>95});
  push(longTitles.length?'warn':'pass','Headlines stay readable',
    longTitles.length?longTitles.length+' headline'+(longTitles.length===1?' is':'s are')+' over 95 characters and will wrap awkwardly at large sizes.':'Every headline fits the display scale.','HEADLINE');

  var duplicateTitles=(function(){
    var seen={},duplicates=0;
    sections.forEach(function(section){
      var key=cleanText(section.content&&section.content.title).toLowerCase();
      if(!key)return;
      if(seen[key])duplicates+=1;else seen[key]=true;
    });
    return duplicates;
  })();
  push(duplicateTitles?'warn':'pass','Each section makes its own point',
    duplicateTitles?duplicateTitles+' section'+(duplicateTitles===1?'':'s')+' repeat a headline used earlier on the page.':'No headline is repeated.','UNIQUE');

  // Structure and argument.
  var families=sections.map(function(section){return section.family});
  var hasProof=families.some(function(family){return ['testimonial','stats','logo','gallery'].indexOf(family)>=0});
  push(hasProof?'pass':'warn','The page carries proof',
    hasProof?'Proof appears as '+families.filter(function(family){return ['testimonial','stats','logo','gallery'].indexOf(family)>=0}).join(', ')+'.':'No testimonials, statistics, logos or gallery. A claim with no evidence rarely converts.','PROOF');

  var closesWell=['cta','contact','pricing'].indexOf(families[families.length-1])>=0;
  push(closesWell?'pass':'warn','The page closes with an action',
    closesWell?'The final band is a '+familyLabels[families[families.length-1]]+'.':'The last section is a '+(familyLabels[families[families.length-1]]||'module')+'. A page with no closing action leaves the visitor nowhere to go.','CLOSE');

  var adjacent=families.filter(function(family,index){return index&&family===families[index-1]});
  push(adjacent.length?'warn':'pass','No two identical sections in a row',
    adjacent.length?'Repeated back to back: '+adjacent.map(function(family){return familyLabels[family]||family}).join(', ')+'.':'Every neighbouring pair of sections uses a different device.','RHYTHM');

  push(sections.length<=12?'pass':'warn','Page length is defensible',
    sections.length+' modules. '+(sections.length<=12?'Within the length a visitor will actually scroll.':'Over twelve modules; consider moving detail to a second page.'),'LENGTH');

  // Design system integrity.
  push(design.buttonStyle?'pass':'fail','A button family is chosen',
    design.buttonStyle?buttonStyle(design.buttonStyle).label+' is applied to primary, secondary and link buttons.':'No button family is set.','BUTTONS');

  push(levels.motion==='still'||Number(design.motion)<=90?'pass':'warn','Motion stays within budget',
    levels.motion==='still'?'Motion is switched off; every section renders immediately.':'Movement is set to '+levels.motion+' ('+tokens.motionDuration+' reveal, '+tokens.motionDistance+' travel).','MOTION-BUDGET');

  /*
   * Six pairs, not two.
   *
   * This used to check canvas/ink and dark/canvas at 4.5:1 and call it a
   * palette. Cards, buttons and pretitles went unmeasured — which is where the
   * real failures were — and holding dark/canvas to a *text* ratio failed four
   * of the thirteen shipped archetypes for having a dark band on a dark page,
   * which is not a fault. `paletteContrastReport` measures what each role is
   * actually for.
   */
  var paletteReport=paletteContrastReport(design.palette),paletteRepairs=design.paletteRepairs||[];
  push(paletteReport.ok?'pass':(design.paletteLocked?'warn':'fail'),'Palette meets the contrast floor',
    paletteReport.ok
      ?(paletteRepairs.length
        ?paletteRepairs.length+' colour'+(paletteRepairs.length===1?' was':'s were')+' adjusted so every pairing is readable ('+paletteRepairs.map(function(entry){return entry.role}).join(', ')+'); all six pairings now clear 4.5:1.'
        :'All six pairings — body on page, body on card, text on the dark band, label on the brand colour — clear 4.5:1.')
      :paletteReport.failures.map(function(row){return row.label+' is '+row.ratio+':1, needs '+row.target+':1'}).join(' · ')
        +(design.paletteLocked?' These are colours you picked by hand, so they were kept as they are.':''),
    'CONTRAST');

  push(Number(design.headline)<=95||Number(design.measure)>=25?'pass':'warn','Type scale and measure agree',
    'Headline size '+design.headline+' with a '+tokens.measure+' reading measure.','TYPE');

  // Brief and AI provenance.
  var briefFilled=['industry','audience','goal','offer'].filter(function(key){return cleanText(project.brief[key]).length>=12}).length;
  push(briefFilled>=3?'pass':briefFilled?'warn':'fail','The brief supports the page',
    briefFilled+' of 4 load-bearing brief fields are complete.','BRIEF');

  push(brain.understanding?'pass':'warn','The brief was read before building',
    brain.understanding
      ? 'Read '+(brain.understanding.source==='ai'?'by '+(brain.understanding.model||'the AI model'):'by the built-in planner')+' with '+Math.round(Number(brain.understanding.confidence||0)*100)+'% confidence.'
      : 'The AI brief reader has not run. Step 01 can check the brief and recommend an archetype and flow.','AI-READ');

  var flow=flowById(project.flowId,project);
  push(flow?'pass':'warn','Page flow provenance is intact',
    flow?(flow.custom?'Custom outline flow "'+flow.name+'" ('+flow.id+').':'Library flow '+flow.id+' · '+flow.name+'.'):'The saved flow id no longer resolves to a flow in the library.','FLOW');

  var score=Math.round(checks.reduce(function(total,check){return total+(check.status==='pass'?1:check.status==='warn'?0.55:0)},0)/checks.length*100);
  return {
    checks:checks,
    comps:base.comps,
    images:base.images,
    score:score,
    warnings:checks.filter(function(check){return check.status==='warn'}).length,
    failures:checks.filter(function(check){return check.status==='fail'}).length
  };
};

/*
 * v4 layer — two builders in one tool.
 *
 * The advanced builder is everything below this comment: five steps, every
 * registered DST attribute, the full pattern library. It is unchanged.
 *
 * The simple builder is a second, narrower path over the *same* project model:
 * four steps, one paragraph of brief, three AI-designed concepts, and only the
 * controls a strategist can use in front of a client. It exists to get three
 * credible options on screen in one sitting; the advanced builder then imports
 * that concept and does the real work.
 *
 * The two share one project. That is the whole design: nothing in the simple
 * builder writes a value the advanced builder cannot read, and a concept touches
 * only the design slice, so switching V1/V2/V3 at any step can never discard
 * content, flow or module work.
 */

var BUILDER_MODES = ['advanced', 'simple'];

var SIMPLE_STEPS = [
  {title:'Brief and Direction',sub:'One paragraph, three concepts'},
  {title:'Page flow',sub:'The best sequence for the brief'},
  {title:'Modules',sub:'Content, media and simple layout'},
  {title:'Review & export',sub:'One JSON for the advanced builder'}
];

function v4Mode(){return state.builderMode==='simple'?'simple':'advanced'}
function v4IsSimple(){return v4Mode()==='simple'}
function v4Steps(){return v4IsSimple()?SIMPLE_STEPS:STEPS}
function v4StepCount(){return v4Steps().length}

/*
 * The simple builder is the front door. It is where the work actually starts —
 * one paragraph of brief, three concepts — and the advanced builder is where it
 * continues once there is something to continue. A first-time visitor opening
 * onto five steps of DST vocabulary has been handed the second half of the tool.
 * A returning session still lands wherever it left off.
 */
state.builderMode=BUILDER_MODES.indexOf(saved&&saved.builderMode)>=0?saved.builderMode:'simple';

/* ---------------------------------------------------------------- *
 * Concepts
 * ---------------------------------------------------------------- */

function v4EnsureSimple(project){
  return typeof briefBrainFeature.ensureSimpleState==='function'?briefBrainFeature.ensureSimpleState(project):null;
}

function v4NormalizeConcepts(list){
  return normalizeConceptList(list,{archetypeKeys:Object.keys(DATA.archetypes)}).map(function(concept,index){
    var source=(Array.isArray(list)?list:[])[index]||{};
    return Object.assign({},concept,{
      archetypeName:DATA.archetypes[concept.archetypeKey]&&DATA.archetypes[concept.archetypeKey].name||concept.archetypeKey,
      backfilled:!!source.backfilled
    });
  });
}

/**
 * Switches the active concept workspace.
 *
 * Nothing is copied in and nothing is captured out. The editor has been writing
 * into this concept all along, so activating another one is a pointer move: the
 * design, the page, the globals, the media placements and the responsive settings
 * that appear are the ones that concept was left with, down to the last field.
 *
 * Accepts an index, a slot (`V2`) or an id (`v2`) so both builders and the
 * concept cards can call it with whatever they hold.
 */
function v4ApplyConcept(target,options){
  var conceptId=conceptIdFrom(target);
  var concept=conceptId?getConcept(state.project,conceptId):null;
  if(!concept||concept.status!=='generated'){
    if(conceptId)announce('That concept has not been generated yet.');
    return;
  }
  var silent=options&&options.silent;
  if(getActiveConceptId(state.project)===conceptId){
    // Already here. Still record the pick, because the first step's exit
    // condition is an explicit choice rather than whatever happens to be shown.
    if(v4MarkConceptChosen(conceptId)&&!silent){renderAll();queueSave()}
    return;
  }
  setActiveConcept(state.project,conceptId);
  v4MarkConceptChosen(conceptId);
  // Typing coalescing belongs to one concept: close the window so the next edit
  // in this concept opens its own history entry.
  clearTimeout(inputHistoryTimer);
  inputHistoryTimer=null;
  // Switching concepts is not an edit: it must not push a history entry, and it
  // must not discard either concept's own undo stack.
  bindProject(state.project);
  v2EnsureProject(state.project);
  v3EnsureDesign(state.project);
  state.project.sections.forEach(syncSectionNode);
  if(!state.project.sections.some(function(s){return s.id===state.selectedSectionId})){
    state.selectedSectionId=state.project.sections[0]?state.project.sections[0].id:null;
  }
  queueSave();
  if(silent)return;
  renderAll();
  announce(concept.slot+' · '+concept.name);
}

/** Records the strategist's pick on the simple builder's concept cards. */
function v4MarkConceptChosen(conceptId){
  var simple=state.project.simple;
  if(!simple||!Array.isArray(simple.concepts)||!simple.concepts.length)return false;
  var index=conceptIndexOf(conceptId);
  if(index<0||index>=simple.concepts.length)return false;
  var changed=simple.active!==index;
  simple.active=index;
  return changed;
}

/**
 * Builds the three concept workspaces from one baseline.
 *
 * All three start as complete copies of the concept currently being edited — the
 * same content, the same flow, the same media — so a client comparing them is
 * comparing design decisions and not three different drafts. Each is then turned
 * into Core, Brand-led or Expressive by resolving its own design.
 */
function v4GenerateConceptWorkspaces(descriptors,options){
  var list=Array.isArray(descriptors)?descriptors:[];
  if(list.length<2)return [];
  /*
   * Re-reading a brief must not silently rebuild three workspaces a strategist
   * has since edited. The new proposals are still recorded on the concept cards;
   * taking one is an explicit "Reset to the generated concept" on that slot.
   */
  if(hasGeneratedConceptSet(state.project)&&!(options&&options.force))return [];
  var baseId=getActiveConceptId(state.project)||'v1';
  var created=generateConceptSet(state.project,{
    baseConceptId:baseId,
    variants:list.slice(0,CONCEPT_IDS.length).map(function(descriptor,index){
      var variant=CONCEPT_VARIANTS[index];
      return {
        id:variant.id,
        name:descriptor&&descriptor.name||variant.name,
        variantType:variant.variantType,
        why:descriptor&&descriptor.why||'',
        style:{archetypeKey:descriptor&&descriptor.archetypeKey||'',preset:descriptor&&descriptor.preset||'',variantType:variant.variantType}
      };
    }),
    applyVariant:function(concept,variant,index){
      var descriptor=list[index];
      var design=resolveConceptDesign(descriptor,{
        archetypeStyle:DATA.archetypeStyles[descriptor&&descriptor.archetypeKey],
        current:concept.design
      });
      if(!design)return;
      // A palette lock belongs to the hand edit that set it, not to a freshly
      // generated concept.
      concept.design.paletteLocked=false;
      concept.design.paletteSignature='';
      CONCEPT_DESIGN_KEYS.forEach(function(key){
        if(design[key]===undefined)return;
        concept.design[key]=key==='palette'?Object.assign({},design[key]):design[key];
      });
    },
    activate:baseId
  });
  // Each workspace is new, so the histories that described the old ones no
  // longer apply to anything.
  created.forEach(function(id){conceptHistory.forget(id)});
  bindProject(state.project);
  v2EnsureProject(state.project);
  v3EnsureDesign(state.project);
  state.project.sections.forEach(syncSectionNode);
  if(!(options&&options.silent))queueSave();
  return created;
}

/**
 * Kept as a no-op for the call sites that used to snapshot design values back
 * into a concept before a switch. There is nothing to capture: a design edit is
 * already a write into the active concept's own `design` object.
 */
function v4CaptureConceptEdit(){}

/* ---------------------------------------------------------------- *
 * The concept pills over the preview
 * ---------------------------------------------------------------- */

/**
 * The V1/V2/V3 switcher.
 *
 * It belongs to the project, not to one builder, so it renders in Simple and in
 * Advanced and on every step where a concept exists. The active concept has to be
 * unmistakable: a strategist who edits the wrong proposal in front of a client
 * has been failed by this bar.
 */
function v4RenderConceptBar(){
  var bar=byId('conceptBar'),pills=byId('conceptPills'),name=byId('conceptBarName');
  if(!bar||!pills)return;
  var concepts=listGeneratedConcepts(state.project);
  if(concepts.length<2){bar.hidden=true;pills.innerHTML='';if(name)name.textContent='';return}
  var activeId=getActiveConceptId(state.project);
  bar.hidden=false;
  pills.innerHTML=concepts.map(function(concept){
    var active=concept.id===activeId;
    var draft=conceptHasDraftChanges(concept);
    return '<button type="button" class="concept-pill'+(active?' is-active':'')+(draft?' has-draft':'')+'" data-concept-pill="'+escAttr(concept.id)+'"'+
      ' aria-pressed="'+(active?'true':'false')+'" title="'+escAttr(concept.slot+' · '+concept.name+' — '+conceptPublishLabel(concept))+'">'+esc(concept.slot)+'</button>';
  }).join('');
  if(name){
    var active=getActiveConcept(state.project);
    name.textContent=active?(active.name+' · '+conceptPublishLabel(active)):'Choose one to continue';
  }
}

byId('conceptPills').addEventListener('click',function(event){
  var pill=event.target.closest('[data-concept-pill]');
  if(!pill)return;
  v4ApplyConcept(pill.dataset.conceptPill);
});

/* ---------------------------------------------------------------- *
 * Brief handoff between the two builders
 * ---------------------------------------------------------------- */

/** Writes the structured fields the concept job derived into the real brief. */
function v4ApplyBriefFields(fields,options){
  if(!fields||typeof fields!=='object')return;
  var brief=state.project.brief,briefText=options&&options.briefText;
  ['industry','audience','goal','offer','tone','keywords'].forEach(function(key){
    var value=cleanText(fields[key]);
    if(value)brief[key]=value;
  });
  var brand=cleanText(fields.clientName);
  if(brand){
    brief.clientName=brand;
    brief.clientNameCustom=true;
    if(!cleanText(brief.projectName)||brief.projectName==='Vision Continuity')brief.projectName=brand;
    v2SyncBrand(state.project,false);
  }
  // The paragraph itself is kept verbatim: it is the record of what the client
  // actually said, and the advanced builder shows it as the internal note. An
  // import replaces the note outright, because the strategist asked for that
  // brief specifically.
  if(briefText&&(options&&options.replaceNotes||!cleanText(brief.notes)))brief.notes=briefText;
}

/* ---------------------------------------------------------------- *
 * Mode-aware step plumbing
 * ---------------------------------------------------------------- */

renderStepNav=function(){
  var steps=v4Steps();
  byId('stepNav').innerHTML=steps.map(function(step,index){
    return '<li><button class="step-btn '+(index===state.currentStep?'active':'')+' '+(index<state.currentStep?'done':'')+'" data-step="'+index+'">'+
      '<span class="step-num">'+(index<state.currentStep?'✓':index+1)+'</span>'+
      '<span class="step-copy"><b>'+esc(step.title)+'</b><span>'+esc(step.sub)+'</span></span>'+
      '<span class="step-state"></span></button></li>';
  }).join('');
};

renderEditorNav=function(){
  var count=v4StepCount(),last=state.currentStep===count-1;
  var blocked=v4IsSimple()&&state.currentStep===0&&!v4CanLeaveSimpleBrief();
  return '<div class="editor-nav"><button class="nav-btn" data-nav="prev" '+(state.currentStep===0?'disabled':'')+'>← Previous</button>'+
    '<span class="nav-hint">Step '+(state.currentStep+1)+' of '+count+(blocked?' · choose a concept':'')+'</span>'+
    '<button class="nav-btn next" data-nav="next"'+(blocked?' disabled aria-disabled="true" title="Choose one of the three concepts first"':'')+'>'+
    (last?'Back to brief':'Continue →')+'</button></div>';
};

/** Step 01 of the simple builder cannot be left until a concept is chosen. */
function v4CanLeaveSimpleBrief(){
  var simple=v4EnsureSimple(state.project);
  return !!(simple&&simple.concepts.length&&simple.active!==null);
}

goStep=function(index){
  var count=v4StepCount();
  if(v4IsSimple()&&state.currentStep===0&&index>0&&!v4CanLeaveSimpleBrief()){
    announce('Choose one of the three concepts to continue.');
    return;
  }
  state.currentStep=clamp(index,0,count-1);
  queueSave();
  renderStepNav();
  renderEditor();
  document.querySelector('.editor').scrollTop=0;
};

renderEditor=function(){
  var renderers=v4IsSimple()
    ? [v4SimpleBrief,v4SimpleFlow,v4SimpleModules,v4SimpleReview]
    : [renderBrief,renderDirection,renderFlow,renderModules,renderReview];
  state.currentStep=clamp(state.currentStep,0,renderers.length-1);
  var host=byId('editorInner');
  /*
   * Replacing the markup blurs whatever was focused, and a blur on a field whose
   * value has been typed into is answered with a `change` — carrying the value
   * that field held *before* this render. To every handler on this element that
   * is indistinguishable from somebody typing, so a programmatic edit that
   * causes a render gets overwritten by its own stale markup a moment later.
   * That is how a brief read out of a dropped document vanished while the cursor
   * was still in the textarea. Nothing that happens during the swap is a person
   * editing, so nothing during the swap is delivered.
   */
  var swallow=function(event){
    if(host.contains(event.target))event.stopImmediatePropagation();
  };
  // On the document, not on the editor: the handlers being headed off are
  // themselves capture listeners on the editor, and among listeners on one node
  // in one phase the earlier registration wins. The document is upstream of all
  // of them.
  document.addEventListener('input',swallow,true);
  document.addEventListener('change',swallow,true);
  try{
    host.innerHTML=renderers[state.currentStep]();
  }finally{
    document.removeEventListener('input',swallow,true);
    document.removeEventListener('change',swallow,true);
  }
  bindDragRows();
};

var renderAllBeforeV4=renderAll;
renderAll=function(){
  renderAllBeforeV4();
  v4RenderModeChrome();
  v4RenderConceptBar();
};

/* ---------------------------------------------------------------- *
 * The mode switcher
 * ---------------------------------------------------------------- */

function v4RenderModeChrome(){
  var simple=v4IsSimple();
  document.body.classList.toggle('is-simple-builder',simple);
  document.body.classList.toggle('is-advanced-builder',!simple);
  document.querySelectorAll('[data-builder-mode]').forEach(function(button){
    var active=button.dataset.builderMode===v4Mode();
    button.classList.toggle('is-active',active);
    button.setAttribute('aria-pressed',active?'true':'false');
  });
  var kicker=byId('sideKicker'),title=byId('sideTitle'),blurb=byId('sideBlurb');
  if(kicker)kicker.textContent=simple?'Simple builder':'Advanced builder';
  if(title)title.textContent=simple?'Three concepts, fast.':'From brief to import.';
  if(blurb)blurb.textContent=simple
    ?'One paragraph of brief becomes three complete concepts you can show a client today.'
    :'Every module remains a real, registered DST component.';
}

function v4SetMode(next,options){
  var mode=BUILDER_MODES.indexOf(next)>=0?next:'advanced';
  if(mode===v4Mode()&&!(options&&options.force))return;
  state.builderMode=mode;
  // Each builder keeps its own idea of where you were, and the simple builder
  // has no DST tree or extended view to return to.
  state.currentStep=0;
  if(mode==='simple'){
    if(state.editorTab==='advanced')state.editorTab='content';
    state.moduleView='simple';
    v4EnsureSimple(state.project);
  }
  queueSave();
  renderAll();
  if(!(options&&options.silent)){
    announce(mode==='simple'
      ? 'Simple builder — one brief, three concepts'
      : 'Advanced builder — the full DST toolset');
  }
}

document.querySelectorAll('[data-builder-mode]').forEach(function(button){
  button.addEventListener('click',function(){v4SetMode(button.dataset.builderMode)});
});

/* ---------------------------------------------------------------- *
 * Simple builder · Step 01 — Brief and Direction
 * ---------------------------------------------------------------- */

/**
 * A collapsible panel.
 *
 * Step 01 asks for one paragraph and then offers palette, type, the button
 * family, the presets and nine dials — which is a long scroll past controls
 * most briefs never touch. Every one of those is now a disclosure, so the step
 * can be read at a glance and opened where it matters. `open` is the default
 * because a panel nobody can see is a panel nobody finds; the button family is
 * the one that starts closed, because the concept already chose one and its ten
 * live samples are the tallest thing on the step.
 */
function v4Panel(title,body,meta,open){
  return '<details class="panel panel-collapsible"'+(open===false?'':' open')+'><summary class="panel-head"><h2>'+title+'</h2>'+
    (meta?'<small>'+meta+'</small>':'')+'<span class="panel-toggle" aria-hidden="true"></span></summary>'+
    '<div class="panel-body">'+body+'</div></details>';
}
/** Globals are reference, not the task at hand, so they start closed. */
function v4ClosedPanel(title,body,meta){return v4Panel(title,body,meta,false)}

/*
 * The simple builder's callbacks are added to the one shared brain context, not
 * to a second one. The feature's event bridge and its panels are handed the same
 * object, and an earlier split meant a concept click reached a context with no
 * `applyConcept` on it.
 */
var v3BrainContextBeforeV4=v3BrainContext;
v3BrainContext=function(){
  return Object.assign(v3BrainContextBeforeV4(),{
    presets:DIAL_PRESETS,
    buttonStyles:BUTTON_STYLES,
    normalizeConcepts:v4NormalizeConcepts,
    applyConcept:v4ApplyConcept,
    generateConcepts:v4GenerateConceptWorkspaces,
    activeConceptId:getActiveConceptId(state.project),
    concepts:listConcepts(state.project),
    applyBriefFields:v4ApplyBriefFields,
    builderMode:v4Mode()
  });
};

function v4SimpleContext(){return v3BrainContext()}

function v4SimpleBrief(){
  v2EnsureProject(state.project);
  v4EnsureSimple(state.project);
  var d=state.project.design;
  // One catalogue, shared with the brief reader — so a brief that names a
  // typeface names one this select can actually offer.
  var fonts=fontOptions();
  var brainPanel=v3BrainPanel(function(){return briefBrainFeature.renderSimpleBriefPanel(v4SimpleContext())});
  var stylePicker=v10StylePicker({
    title:'What style would you like for this project?',
    blurb:'Pick a family, then one of its five styles. The three concepts are built from the style you choose: V1 as it is authored, V2 with your brand colours, V3 pushed further in the same language.'
  });

  return pageHead('01 · Brief and Direction','Write the brief. Get three concepts.','One paragraph is all the brain needs. It reads your brief, then designs three complete concepts — palette, type, spacing, movement and buttons — that you can switch between at any point using the pills on the preview.',v4ModeBadge())+
    brainPanel+
    stylePicker+
    v4Panel('Palette and type','<div class="panel-note">The chosen style sets these. Adjust anything and it stays with that concept — switching away and back keeps your edit.</div><div class="palette-row">'+
      [['bg','Canvas'],['ink','Ink'],['accent','Accent'],['soft','Soft'],['dark','Dark']].map(function(x){
        return '<label class="color-field"><input type="color" data-bind="design.palette.'+x[0]+'" value="'+escAttr(d.palette[x[0]])+'"><span>'+x[1]+'</span></label>';
      }).join('')+'</div>'+v9PaletteHealth(d)+'<div class="field-grid" style="margin-top:16px">'+
      field('Body typeface','design.fontBody',d.fontBody,{type:'select',options:fonts})+
      field('Display typeface','design.fontDisplay',d.fontDisplay,{type:'select',options:fonts})+'</div>','From the concept')+
    v4Panel('Button family','<div class="panel-note">Hover any sample to see exactly what a visitor will see.</div>'+v3ButtonStylePanel(d),buttonStyle(d.buttonStyle).label+' · open to change it',false)+
    v4Panel('Quick styles',v3PresetButtons(d),'Safe starting points')+
    v4Panel('Design dials',v3DialSample(d)+v3DialGroups(d),'Live system controls · every slider updates the whole site')+
    v4ClosedPanel('Navigation and footer',v2GlobalEditors(),'Optional · global parts')+
    renderEditorNav();
}

function v4ModeBadge(){
  var simple=v4EnsureSimple(state.project);
  if(!simple||!simple.concepts.length)return 'Simple builder';
  return simple.active===null?'Choose a concept':(simple.concepts[simple.active].slot+' · '+simple.concepts[simple.active].name);
}

/* ---------------------------------------------------------------- *
 * Simple builder · Step 02 — Page flow
 * ---------------------------------------------------------------- */

function v4SimpleFlow(){
  v2EnsureProject(state.project);
  var flow=flowById(state.project.flowId)||FLOW_CATALOG[0];
  return pageHead('02 · Page flow','Choose the sequence.','The brain ranked every flow in the library against your brief. Pick one of the five recommendations, or describe the page you want in your own words.',flow.id+' · '+flow.name)+
    v3BrainPanel(function(){return briefBrainFeature.renderSimpleFlowPanel(v4SimpleContext())})+
    renderEditorNav();
}

/* ---------------------------------------------------------------- *
 * Simple builder · Step 03 — Modules
 * ---------------------------------------------------------------- */

var SIMPLE_EDITOR_TABS=[['content','Content'],['media','Media'],['layout','Layout + effects']];

function v4SimpleModules(){
  v2EnsureProject(state.project);
  // The simple builder has no extended view and no DST tree: both exist to
  // expose raw block attributes, which is the advanced builder's job.
  state.moduleView='simple';
  if(!SIMPLE_EDITOR_TABS.some(function(tab){return tab[0]===state.editorTab}))state.editorTab='content';
  var section=state.project.sections.find(function(x){return x.id===state.selectedSectionId})||state.project.sections[0];
  if(section)state.selectedSectionId=section.id;
  var editor=section?({content:renderContentEditor,media:renderMediaEditor,layout:renderLayoutEditor}[state.editorTab]||renderContentEditor)(section):'';

  return pageHead('03 · Modules','Shape the page.','Write the copy from your brief, reorder the sequence, then edit any module. Every choice here is safe: the structure stays a real registered DST composition.',section?familyLabels[section.family]||section.family:'No modules')+
    panel('Page sequence','<div id="moduleList" class="module-list">'+moduleRows()+'</div>'+
      '<button class="add-row" data-action="add-module" style="width:100%;margin-top:8px">+ Add a section</button>',
      'Drag to reorder · select to edit')+
    (section
      ? panel('Selected pattern','<div class="pattern-summary"><div class="pattern-thumb"></div><div><b>'+esc(patternLabel(section))+'</b><span>'+esc(section.family)+'</span></div><button class="text-btn" data-action="choose-pattern">Change pattern</button></div>')+
        panel('Module editor','<div class="segmented" style="margin-bottom:15px">'+SIMPLE_EDITOR_TABS.map(function(tab){
          return '<button class="'+(state.editorTab===tab[0]?'active':'')+'" data-editor-tab="'+tab[0]+'">'+tab[1]+'</button>';
        }).join('')+'</div>'+editor,'','data-module-editor')
      : '<div class="empty-state"><b>Add the first section</b><p>Choose from the registered pattern library.</p><button class="export-btn" data-action="add-module">Add section</button></div>')+
    renderEditorNav();
}

/* ---------------------------------------------------------------- *
 * Simple builder · Step 04 — Review and export
 * ---------------------------------------------------------------- */

function v4SimpleReview(){
  var validation=validateProject(),simple=v4EnsureSimple(state.project);
  var concept=simple&&simple.active!==null?simple.concepts[simple.active]:null;
  return pageHead('04 · Review & export','WordPress-ready handoff.','The Simple and Advanced builders now export through the exact same page, navigation, footer and standalone-site pipeline. Download the individual artifacts or one complete ZIP.',validation.failures?validation.failures+' blockers':validation.warnings?validation.warnings+' notes':'Ready')+
    v5ConceptsPanel()+
    panel('Concept health','<div class="review-grid">'+
      '<div class="score-card"><b>'+validation.score+'</b><span>Readiness score</span></div>'+ 
      '<div class="score-card"><b>'+state.project.sections.length+'</b><span>Page sections</span></div>'+ 
      '<div class="score-card"><b>'+(concept?esc(concept.slot):'—')+'</b><span>Chosen concept</span></div>'+ 
      '</div>'+(concept?'<div class="panel-note" style="margin:14px 0 0">'+esc(concept.name)+' — '+esc(concept.why)+'</div>':''))+
    panel('Preflight checks','<div class="check-list">'+validation.checks.map(function(check){
      return '<div class="check '+check.status+'"><span class="check-ico">'+(check.status==='pass'?'✓':check.status==='warn'?'!':'×')+'</span>'+ 
        '<div><b>'+esc(check.title)+'</b><p>'+esc(check.detail)+'</p></div><code>'+check.code+'</code></div>';
    }).join('')+'</div>','Same checks as Advanced')+
    panel('WordPress-ready downloads',
      '<div class="export-card"><div class="export-icon"><svg viewBox="0 0 24 24"><path d="M4 5h16v4H4zM4 12h16v7H4z"/></svg></div><div><b>Navigation JSON</b><p>Global navigation with its complete registered tree and responsive settings.</p></div><button class="export-btn" data-export="navigation">Download</button></div>'+ 
      '<div class="export-card"><div class="export-icon"><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4zM4 15h16"/></svg></div><div><b>Footer JSON</b><p>Global footer template part, menus, socials, legal content and design metadata.</p></div><button class="export-btn" data-export="footer">Download</button></div>'+ 
      '<div class="export-card"><div class="export-icon"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M10 13h5M10 17h5"/></svg></div><div><b>Page JSON</b><p>The same WordPress importer page artifact produced by Advanced, including full resolved design-dial tokens.</p></div><button class="export-btn" data-export="page">Download</button></div>'+ 
      '<div class="export-card"><div class="export-icon"><svg viewBox="0 0 24 24"><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/></svg></div><div><b>Standalone website HTML</b><p>Navigation, page and footer rendered together for visual handoff.</p></div><button class="export-btn" data-export="html">Download</button></div>'+ 
      '<div class="export-card"><div class="export-icon"><svg viewBox="0 0 24 24"><path d="M4 6h16v12H4zM8 10h8M8 14h5"/></svg></div><div><b>Complete project bundle</b><p>ZIP containing navigation.json, footer.json, page.json and website.html.</p></div><button class="export-btn" data-export="bundle">Download ZIP</button></div>',
      'Simple and Advanced use one export contract')+
    panel('Continue in Advanced','<div class="export-card"><div class="export-icon"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/></svg></div><div><b>Concept JSON</b><p>Optional editing handoff containing your brief, all three concepts and the current project state.</p></div><button class="export-btn" data-export="simple-concept">Download JSON</button></div>','Optional')+
    renderEditorNav();
}

/* ---------------------------------------------------------------- *
 * The style library
 * ---------------------------------------------------------------- */

/** The style the active concept is resolving its design from, if any. */
function v10ActiveStyle(){
  var concept=getActiveConcept(state.project);
  return concept?styleFromRef(concept.style):null;
}

function v10ConceptStyle(concept){
  return concept?styleFromRef(concept.style):null;
}

/** What the strategist last browsed. Editor state, not project state. */
function v10SelectedFamily(){
  if(state.styleFamilyId&&STYLE_FAMILIES.some(function(f){return f.id===state.styleFamilyId}))return state.styleFamilyId;
  var active=v10ActiveStyle();
  return active?active.familyId:'';
}

/**
 * Applies a style to one concept.
 *
 * The style is recorded on the concept and the design is compiled from it, so the
 * concept keeps a reference to *why* it looks the way it does rather than only the
 * resolved values. Manual edits already made on that concept are re-applied last,
 * which is the precedence rule in §41: a strategist's own change is never undone
 * by re-resolving a style.
 */
function v10ApplyStyleToConcept(concept,profile,options){
  if(!concept||!profile)return false;
  var config=options||{};
  var variantType=CONCEPT_VARIANT_TYPES.indexOf(config.variantType)>=0?config.variantType:(concept.variantType||'core');
  var directives=briefDirectives(state.project.brief);
  var design=compileStyle(profile,{
    variantType:variantType,
    brand:directives.any?directives:null,
    manual:config.keepManual===false?null:(concept.manualOverrides||null),
    current:concept.design
  });
  if(!design)return false;
  concept.design=design;
  concept.style={
    familyId:profile.familyId,
    styleId:profile.id,
    styleVersion:profile.version,
    variantType:variantType,
    archetypeKey:'',
    preset:''
  };
  touchConcept(concept);
  return true;
}

/** Re-lays every section in a concept using the style's component recipes. */
function v10RestyleSections(concept,profile){
  if(!concept||!profile||!Array.isArray(concept.sections))return;
  concept.sections.forEach(function(section,index){
    var base=sectionPreset(section.family,index);
    var recipe=compileSectionRecipe(profile,section.family,{base:base});
    ensureSectionSettings(section);
    section.layout=section.layout||{};
    if(recipe.container)section.layout.container=recipe.container;
    if(recipe.paddingTop)section.layout.paddingTop=recipe.paddingTop;
    if(recipe.paddingBottom)section.layout.paddingBottom=recipe.paddingBottom;
    if(recipe.inverted!==undefined)section.layout.inverted=recipe.inverted;
    if(recipe.viewport!==undefined){section.effects=section.effects||{};section.effects.viewport=recipe.viewport}
    if(recipe.decoration)section.decoration=recipe.decoration;
    if(recipe.styleColumns){
      if(recipe.styleColumns.desktop)section.layout.columns=recipe.styleColumns.desktop;
      if(recipe.styleColumns.mobile)section.layout.columnsMobile=recipe.styleColumns.mobile;
    }
  });
}

/** The strategist chose a style for the concept on screen. */
function v10ChooseStyle(key,options){
  var profile=styleByKey(key);
  if(!profile){announce('That style is not in the library.');return}
  var concept=getActiveConcept(state.project);
  if(!concept)return;
  var config=options||{};
  var swapped=0;
  mutate(function(){
    v10ApplyStyleToConcept(concept,profile,{variantType:concept.variantType});
    // Patterns first: `switchPattern` rebuilds the block tree from the new
    // pattern, so the style's own layout has to be written on top of that.
    swapped=v10RepatternSections(concept,profile);
    v10RestyleSections(concept,profile);
    v3EnsureDesign(state.project);
  },{message:concept.slot+' · '+profile.name+(swapped?' · '+swapped+' module'+(swapped===1?'':'s')+' re-chosen':'')});
  if(config.thenGenerate)v10GenerateFromStyle(key);
}

/**
 * Builds the three concepts from one chosen style.
 *
 * All three derive from the same style profile so a client is comparing
 * interpretations of one design language rather than three unrelated websites:
 * V1 as authored, V2 with the client's brand let in as far as the style allows,
 * V3 pushing the axes the style is already expressive on.
 */
function v10GenerateFromStyle(key,options){
  var profile=styleByKey(key);
  if(!profile)return [];
  var config=options||{};
  var created=[];
  mutate(function(){
    created=generateConceptSet(state.project,{
      baseConceptId:getActiveConceptId(state.project)||'v1',
      variants:CONCEPT_VARIANTS.map(function(variant){
        return {
          id:variant.id,
          name:variant.name,
          variantType:variant.variantType,
          why:v10VariantWhy(profile,variant.variantType),
          style:{familyId:profile.familyId,styleId:profile.id,styleVersion:profile.version,variantType:variant.variantType}
        };
      }),
      applyVariant:function(concept,variant){
        v10ApplyStyleToConcept(concept,profile,{variantType:variant.variantType,keepManual:false});
        v10RepatternSections(concept,profile);
        v10RestyleSections(concept,profile);
      },
      activate:'v1'
    });
    created.forEach(function(id){conceptHistory.forget(id)});
    bindProject(state.project);
    v2EnsureProject(state.project);
    v3EnsureDesign(state.project);
    state.project.sections.forEach(syncSectionNode);
  },{message:'Three concepts from '+profile.name});
  if(!(config&&config.silent))v4MarkConceptChosen('v1');
  return created;
}

/** Why this slot looks the way it does, in a sentence a client can read. */
function v10VariantWhy(profile,variantType){
  var rule=variantRule(variantType);
  if(variantType==='brand-led')return 'The '+profile.name+' language with your brand colours taken as far as this style allows.';
  if(variantType==='expressive')return profile.name+', pushed on the axes it is already strongest on — scale, movement and expression.';
  return profile.name+' as it is authored: '+String(profile.description||'').slice(0,150);
}

/* ---- the picker ---- */

function v10StyleCardMarkup(profile,activeKey){
  var key=styleKey(profile);
  var active=key===activeKey;
  var swatches=['bg','ink','accent','soft','dark'].map(function(role){
    return '<i style="background:'+escAttr(profile.palette[role])+'"></i>';
  }).join('');
  return '<button type="button" class="style-card'+(active?' is-active':'')+'" data-style-key="'+escAttr(key)+'"'+
    ' aria-pressed="'+(active?'true':'false')+'">'+
    '<span class="style-card__swatches" aria-hidden="true">'+swatches+'</span>'+
    '<b>'+esc(profile.name)+'</b>'+
    '<p>'+esc(profile.description)+'</p>'+
    '<span class="style-card__meta"><em>'+esc(profile.polarity)+'</em>'+
    profile.tags.slice(0,3).map(function(tag){return '<span>'+esc(tag)+'</span>'}).join('')+'</span>'+
    (active?'<span class="style-card__active">In use</span>':'')+
    '</button>';
}

/**
 * Family, then style. The AI recommends and the human chooses (§17): a badge can
 * mark a strong match but nothing is selected without a click.
 */
function v10StylePicker(options){
  var config=options||{};
  var activeStyle=v10ActiveStyle();
  var activeKey=activeStyle?styleKey(activeStyle):'';
  var familyId=v10SelectedFamily();
  var counts=styleCounts();
  var families=styleFamilies();
  var familyButtons=families.map(function(family){
    var selected=family.id===familyId;
    return '<button type="button" class="style-family'+(selected?' is-active':'')+'" data-style-family="'+escAttr(family.id)+'"'+
      ' aria-pressed="'+(selected?'true':'false')+'"><b>'+esc(family.name)+'</b><span>'+esc(family.blurb)+'</span>'+
      '<em>'+family.styles.length+' styles</em></button>';
  }).join('');
  var chosenFamily=families.find(function(family){return family.id===familyId})||null;
  var styleGrid=chosenFamily
    ? '<div class="style-grid">'+chosenFamily.styles.map(function(profile){return v10StyleCardMarkup(profile,activeKey)}).join('')+'</div>'
    : '<div class="panel-note">Choose a style family to see its five styles.</div>';
  var generate=chosenFamily&&activeStyle&&activeStyle.familyId===familyId
    ? '<div class="style-actions"><button type="button" class="export-btn" data-style-action="generate">'+
      (hasGeneratedConceptSet(state.project)?'Rebuild V1/V2/V3 from '+esc(activeStyle.name):'Generate V1/V2/V3 from '+esc(activeStyle.name))+
      '</button><span class="panel-note" style="margin:0">V1 as authored · V2 with your brand colours · V3 pushed further, in the same language.</span></div>'
    : '';
  return panel(config.title||'Style family',
    '<div class="panel-note">'+esc(config.blurb||'Ten families, five styles each. A style sets the palette, the type, all nine dials, how each band is composed and which of the 154 patterns the builder reaches for.')+'</div>'+
    '<div class="style-families">'+familyButtons+'</div>'+
    (chosenFamily?'<div class="style-family-head"><b>'+esc(chosenFamily.name)+'</b><span>'+esc(chosenFamily.blurb)+'</span></div>':'')+
    styleGrid+generate,
    counts.families+' families · '+counts.styles+' styles');
}

/** The style row on a review or concept panel. */
function v10StyleLabel(concept){
  var profile=v10ConceptStyle(concept);
  if(profile)return profile.familyId+' → '+profile.name;
  return '';
}

byId('editorInner').addEventListener('click',function(event){
  var family=event.target.closest('[data-style-family]');
  if(family){
    state.styleFamilyId=family.dataset.styleFamily;
    renderEditor();
    return;
  }
  var card=event.target.closest('[data-style-key]');
  if(card){
    v10ChooseStyle(card.dataset.styleKey);
    return;
  }
  var action=event.target.closest('[data-style-action]');
  if(action&&action.dataset.styleAction==='generate'){
    var active=v10ActiveStyle();
    if(!active){announce('Choose a style first.');return}
    if(hasGeneratedConceptSet(state.project)
      &&!window.confirm('Rebuild all three concepts from '+active.name+'? Every change made to V1, V2 and V3 is replaced.'))return;
    v10GenerateFromStyle(styleKey(active));
    renderAll();
  }
});

/* ---------------------------------------------------------------- *
 * The concept workspaces panel
 * ---------------------------------------------------------------- */

/*
 * Icons for the concept row.
 *
 * Open is an arrow leaving a frame, reset is a counter-clockwise turn back to the
 * start, and copy reuses the editor's own copy glyph with the destination slot
 * beside it — so "copy into V2" reads off the button rather than out of a tooltip.
 */
var CONCEPT_ICONS={
  open:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-8 8"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  reset:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5v5h5"/><path d="M4.9 10.4A7.5 7.5 0 1 1 4.2 14"/></svg>',
  copy:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="1"/><path d="M15 9V6a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3"/></svg>'
};

/**
 * One icon action on a concept row.
 *
 * `data-tip` draws the hover label and `aria-label` is the accessible name; both
 * carry the same sentence, so what a pointer reveals and what a screen reader
 * announces cannot drift apart.
 */
function v5ConceptAction(action,conceptId,options){
  var config=options||{};
  return '<button type="button" class="concept-action" data-concept-action="'+escAttr(action)+'"'+
    ' data-concept-id="'+escAttr(conceptId)+'"'+
    (config.target?' data-concept-target="'+escAttr(config.target)+'"':'')+
    ' data-tip="'+escAttr(config.tip)+'" aria-label="'+escAttr(config.tip)+'">'+
    CONCEPT_ICONS[config.icon||action]+
    (config.label?'<b>'+esc(config.label)+'</b>':'')+
    '</button>';
}

/** What a concept currently resolves its design from, in plain language. */
function v5ConceptStyleLabel(concept){
  var style=concept.style||{};
  var fromLibrary=v10StyleLabel(concept);
  if(fromLibrary)return fromLibrary;
  if(style.familyId&&style.styleId)return style.familyId+' → '+style.styleId;
  var key=(concept.design&&concept.design.archetype)||style.archetypeKey||'';
  var archetype=DATA.archetypes[key];
  return archetype?(key+' — '+archetype.name):(key||'Custom');
}

/**
 * One row per concept workspace, in both builders.
 *
 * Every control here operates on one concept and says which. The two that can
 * discard work — reset and copy — confirm first, because §102's rule is that a
 * concept is never reset except on purpose.
 */
function v5ConceptsPanel(){
  var concepts=listGeneratedConcepts(state.project);
  if(!concepts.length)return '';
  /*
   * One concept still gets a row.
   *
   * A strategist working in Advanced before generating the set still needs to see
   * which style the page is on and be able to reset it. Showing only an
   * explanation would answer a question they did not ask and hide the one they did.
   */
  var incomplete=concepts.length<CONCEPT_IDS.length;
  var activeId=getActiveConceptId(state.project);
  var rows=concepts.map(function(concept){
    var active=concept.id===activeId;
    var targets=concepts.filter(function(other){return other.id!==concept.id});
    return '<div class="concept-row'+(active?' is-active':'')+'" data-concept-row="'+escAttr(concept.id)+'">'+
      '<div class="concept-row__id"><b>'+esc(concept.slot)+'</b><span>'+esc(concept.name)+'</span></div>'+
      '<dl class="concept-row__facts">'+
        '<div><dt>Design source</dt><dd>'+esc(v5ConceptStyleLabel(concept))+'</dd></div>'+
        '<div><dt>Variation</dt><dd>'+esc(concept.variantType)+'</dd></div>'+
        '<div><dt>Modules</dt><dd>'+(concept.sections||[]).length+'</dd></div>'+
        '<div><dt>Revision</dt><dd>'+esc(String(concept.revision))+'</dd></div>'+
      '</dl>'+
      '<div class="concept-row__actions">'+
        (active
          ? '<span class="concept-row__here">Editing this one</span>'
          : v5ConceptAction('open',concept.id,{tip:'Open '+concept.slot,label:concept.slot}))+
        (concept.generatedFrom
          ? v5ConceptAction('reset',concept.id,{tip:'Reset '+concept.slot+' to generated'})
          : '')+
        targets.map(function(target){
          return v5ConceptAction('copy',concept.id,{
            target:target.id,
            icon:'copy',
            label:target.slot,
            tip:'Copy '+concept.slot+' over '+target.slot
          });
        }).join('')+
      '</div></div>';
  }).join('');
  return panel('Concept workspaces',
    '<div class="panel-note">'+(incomplete
      ? 'This project has '+concepts.length+' of '+CONCEPT_IDS.length+' concept workspaces. Choose a style in Step 02 and generate V1, V2 and V3 to get three independently editable proposals from it.'
      : 'Three independently editable proposals. Each owns its own style, design dials, page flow, modules, media placements, navigation and footer; the brief and the media library are shared. Exports always come from the concept you are editing.')+'</div>'+
    '<div class="concept-rows">'+rows+'</div>'+
    '<div class="export-card"><div class="export-icon"><svg viewBox="0 0 24 24"><path d="M4 6h16v12H4zM8 10h8M8 14h5"/></svg></div>'+
    '<div><b>All-concepts archive</b><p>One ZIP with a folder per concept, each holding that concept\'s navigation.json, footer.json, page.json and website.html. For handoff and record — WordPress imports one concept at a time.</p></div>'+
    '<button class="export-btn" data-export="all-concepts">Download</button></div>',
    esc(getActiveConcept(state.project)?getActiveConcept(state.project).slot+' active':''));
}

byId('editorInner').addEventListener('click',function(event){
  var trigger=event.target.closest('[data-concept-action]');
  if(!trigger)return;
  var action=trigger.dataset.conceptAction,conceptId=trigger.dataset.conceptId;
  var concept=getConcept(state.project,conceptId);
  if(!concept)return;
  if(action==='open'){v4ApplyConcept(conceptId);return}
  if(action==='reset'){
    if(!window.confirm('Reset '+concept.slot+' to the concept it was generated as? Every change made to '+concept.slot+' is discarded. The other concepts are untouched.'))return;
    if(!resetConcept(state.project,conceptId)){announce('That concept has no generated version to reset to.');return}
    conceptHistory.forget(conceptId);
    v5SettleActiveConcept();
    renderAll();queueSave();updateUndoButtons();
    announce(concept.slot+' reset to its generated design');
    return;
  }
  if(action==='copy'){
    var target=getConcept(state.project,trigger.dataset.conceptTarget);
    if(!target)return;
    if(!window.confirm('Copy '+concept.slot+' over '+target.slot+'? Everything currently in '+target.slot+' is replaced. Its public link and publish state are not copied.'))return;
    if(!duplicateConcept(state.project,conceptId,target.id)){announce('That concept could not be copied.');return}
    conceptHistory.forget(target.id);
    v5SettleActiveConcept();
    renderAll();queueSave();updateUndoButtons();
    announce(concept.slot+' copied into '+target.slot);
  }
});

/** Re-derives everything that hangs off the active concept after it changes. */
function v5SettleActiveConcept(){
  bindProject(state.project);
  v2EnsureProject(state.project);
  v3EnsureDesign(state.project);
  state.project.sections.forEach(syncSectionNode);
  if(!state.project.sections.some(function(s){return s.id===state.selectedSectionId})){
    state.selectedSectionId=state.project.sections[0]?state.project.sections[0].id:null;
  }
}

/* ---------------------------------------------------------------- *
 * The concept JSON: export and import
 * ---------------------------------------------------------------- */

function v4BuildConceptExport(project){
  v2EnsureProject(project);
  var simple=v4EnsureSimple(project)||{};
  var out=buildExport(project);
  out.artifactType='simple-concept';
  out.$schemaComment='SBS simple-builder concept. Import this in the advanced builder to continue.';
  out.simpleBuilder={
    schemaVersion:briefBrainFeature.SIMPLE_SCHEMA_VERSION||'sbs-simple-builder/1.0',
    // The DST tree above is the WordPress contract; this is the editing
    // contract. Without it an import would rebuild every module from pattern
    // defaults and silently discard the copy the strategist wrote.
    sections:(project.sections||[]).map(function(section){
      return {
        id:section.id,
        family:section.family,
        patternId:section.patternId,
        visible:section.visible!==false,
        content:deepClone(section.content||{}),
        layout:deepClone(section.layout||{}),
        effects:deepClone(section.effects||{}),
        decoration:deepClone(section.decoration||null),
        fidelity:deepClone(section.fidelity||null)
      };
    }),
    briefText:simple.briefText||'',
    fields:simple.fields||null,
    readback:simple.readback||null,
    confidence:simple.confidence||0,
    concepts:deepClone(simple.concepts||[]),
    active:simple.active,
    flows:deepClone(simple.flows||[]),
    source:simple.source||'',
    model:simple.model||'',
    generatedAt:simple.generatedAt||''
  };
  // The pool travels with the concept so the advanced builder's picker still
  // offers every preview the brief paid for, not just the ones already placed.
  if(state.project.media&&Array.isArray(state.project.media.assets)&&state.project.media.assets.length){
    out.stockMedia=deepClone(state.project.media);
  }
  return out;
}

var handleExportBeforeV4=handleExport;
handleExport=async function(type){
  if(type!=='simple-concept')return handleExportBeforeV4(type);
  var slug=slugify(state.project.brief.projectName||state.project.brief.clientName);
  downloadFile(slug+'-concept.json',JSON.stringify(v4BuildConceptExport(state.project),null,2),'application/json');
  announce('Concept JSON downloaded — import it in the advanced builder');
};

/**
 * Imports a concept JSON into the advanced builder.
 *
 * Everything structural comes straight out of the file. The brief fields are the
 * one thing that may be missing — an older file, or one written before the
 * concept job ran — so those are asked of the brain, with the deterministic
 * split as the floor.
 */
async function v4ImportConcept(file){
  var text;
  try{text=await file.text()}catch(error){announce('That file could not be read.');return}
  var payload=safeJson(text);
  if(!payload||typeof payload!=='object'){announce('That file is not valid JSON.');return}
  var page=payload.concept&&payload.concept.page,globals=payload.concept&&payload.concept.global;
  if(!page||!Array.isArray(page.sections)||!page.sections.length){
    announce('That file has no page sections. Export a concept JSON from the simple builder.');
    return;
  }
  var simplePayload=payload.simpleBuilder||{};
  announce('Importing concept…');
  var fields=simplePayload.fields;
  var briefText=cleanText(simplePayload.briefText);
  // A file whose fields never made it through still has the paragraph, and the
  // advanced builder is unusable without the individual fields.
  if(briefText&&(!fields||!cleanText(fields.industry))&&typeof briefBrainFeature.expandBriefForImport==='function'){
    var expanded=await briefBrainFeature.expandBriefForImport(briefText);
    if(expanded&&!expanded.error)fields=expanded;
  }
  mutate(function(){
    v4RestoreImportedProject(payload,page,globals,simplePayload);
    if(fields)v4ApplyBriefFields(fields,{briefText:briefText,replaceNotes:true});
  },{message:'Concept imported'});
  v4SetMode('advanced',{silent:true,force:true});
  state.currentStep=0;
  queueSave();
  renderAll();
  announce('Concept imported. Brief, design and '+state.project.sections.length+' sections are in the advanced builder.');
}

function v4RestoreImportedProject(payload,page,globals,simplePayload){
  var project=state.project;
  // Sections are rebuilt through createSection so every imported module is a
  // real, registered pattern with the builder's own content model — an imported
  // node tree is evidence, not a substitute for the model.
  // The editing model is preferred; the DST tree is the fallback for a file
  // written before that model was carried, and reconstructs structure only.
  var source=Array.isArray(simplePayload&&simplePayload.sections)&&simplePayload.sections.length
    ? simplePayload.sections
    : page.sections;
  var restored=source.map(function(section,index){
    var patternId=cleanText(section.patternId||section.pattern||'');
    var pattern=patternMap.get(patternId);
    var family=pattern?pattern.family:cleanText(section.family||section.role||'text');
    var rebuilt=createSection(family,index,pattern?pattern.id:null);
    if(section.content&&typeof section.content==='object')rebuilt.content=deepClone(section.content);
    if(section.layout&&typeof section.layout==='object')rebuilt.layout=Object.assign(rebuilt.layout||{},deepClone(section.layout));
    if(section.effects&&typeof section.effects==='object')rebuilt.effects=Object.assign(rebuilt.effects||{},deepClone(section.effects));
    if(section.decoration!==undefined)rebuilt.decoration=deepClone(section.decoration);
    if(section.fidelity&&typeof section.fidelity==='object')rebuilt.fidelity=deepClone(section.fidelity);
    if(section.visible===false)rebuilt.visible=false;
    return rebuilt;
  });
  if(restored.length)project.sections=restored;
  if(payload.stockMedia&&typeof payload.stockMedia==='object')project.media=deepClone(payload.stockMedia);
  var flowId=cleanText(page.flow&&page.flow.id);
  if(Array.isArray(payload.customFlows))project.customFlows=deepClone(payload.customFlows);
  if(flowId&&flowExists(flowId,project))project.flowId=flowId;
  if(globals&&globals.navigation&&globals.navigation.nav)project.header=v4HeaderFromExport(globals.navigation,project.header);
  if(globals&&globals.footer&&globals.footer.footer)project.footer=v4FooterFromExport(globals.footer,project.footer);
  if(payload.concept&&payload.concept.design)v4DesignFromExport(payload.concept.design);
  var simple=v4EnsureSimple(project);
  if(simple&&simplePayload&&typeof simplePayload==='object'){
    simple.briefText=cleanText(simplePayload.briefText)||simple.briefText;
    simple.readback=simplePayload.readback||simple.readback;
    simple.fields=simplePayload.fields||simple.fields;
    simple.confidence=Number(simplePayload.confidence)||simple.confidence;
    simple.concepts=v4NormalizeConcepts(simplePayload.concepts||[]);
    simple.flows=Array.isArray(simplePayload.flows)?deepClone(simplePayload.flows):[];
    simple.source=cleanText(simplePayload.source);
    simple.model=cleanText(simplePayload.model);
    simple.generatedAt=cleanText(simplePayload.generatedAt);
    simple.generatedFrom=simple.briefText;
    var active=Number(simplePayload.active);
    simple.active=Number.isInteger(active)&&active>=0&&active<simple.concepts.length?active:null;
    simple.status=simple.concepts.length?'ready':'idle';
  }
  state.selectedSectionId=project.sections[0]&&project.sections[0].id||null;
  project.sections.forEach(function(section){ensureSectionSettings(section);syncSectionNode(section)});
}

function v4HeaderFromExport(node,current){
  var nav=node.nav||{},header=Object.assign({},current);
  if(nav.brand){
    if(cleanText(nav.brand.text)){header.logoText=cleanText(nav.brand.text);header.logoTextCustom=true}
    if(cleanText(nav.brand.mark)){header.logoMark=cleanText(nav.brand.mark);header.logoMarkCustom=true}
  }
  if(Array.isArray(nav.menu)&&nav.menu.length){
    header.nav=nav.menu.slice(0,10).map(function(item){return [cleanText(item&&item.label),normalizeLink(item&&item.url)]}).filter(function(pair){return pair[0]});
  }
  if(nav.cta&&cleanText(nav.cta.text))header.cta={text:cleanText(nav.cta.text),link:normalizeLink(nav.cta.url||nav.cta.link)};
  // The phone composition is a real design decision made in the simple builder,
  // so it has to survive the handoff into the advanced one.
  if(nav.mobileMenu||node.attributes&&node.attributes.mobileMenuStyle){
    header.mobileMenu=mobileMenuStyle(nav.mobileMenu||node.attributes.mobileMenuStyle);
  }
  return header;
}

function v4FooterFromExport(node,current){
  var data=node.footer||{},footer=Object.assign({},current);
  if(data.brand){
    if(cleanText(data.brand.text)){footer.logoText=cleanText(data.brand.text);footer.logoTextCustom=true}
    if(cleanText(data.brand.mark)){footer.logoMark=cleanText(data.brand.mark);footer.logoMarkCustom=true}
  }
  if(cleanText(data.statement))footer.statement=cleanText(data.statement);
  if(cleanText(data.description))footer.description=cleanText(data.description);
  if(cleanText(data.legal)){footer.legal=cleanText(data.legal);footer.legalCustom=true}
  if(Array.isArray(data.columns)&&data.columns.length){
    footer.columns=data.columns.slice(0,4).map(function(column,index){
      return {
        title:cleanText(column&&column.title)||'Column '+(index+1),
        menuLocation:cleanText(column&&column.menuLocation)||'footer-menu',
        links:(Array.isArray(column&&column.links)?column.links:[]).slice(0,8).map(function(link){
          return [cleanText(link&&link.label),normalizeLink(link&&link.url)];
        }).filter(function(pair){return pair[0]})
      };
    });
  }
  return footer;
}

/** Design values from an export, filtered through the same guards as the UI. */
function v4DesignFromExport(design){
  var target=state.project.design;
  if(!design||typeof design!=='object')return;
  if(/^[A-M]$/.test(cleanText(design.archetype)))target.archetype=cleanText(design.archetype);
  if(design.palette&&typeof design.palette==='object'){
    ['bg','ink','accent','soft','dark'].forEach(function(key){
      var value=cleanText(design.palette[key]);
      if(/^#[0-9a-f]{3,8}$/i.test(value))target.palette[key]=value;
    });
  }
  ['fontBody','fontDisplay'].forEach(function(key){
    var value=cleanText(design[key]);
    if(value&&value.length<=64)target[key]=value;
  });
  if(/^\d{1,3}px$/.test(cleanText(design.radius)))target.radius=cleanText(design.radius);
  DIAL_KEYS.forEach(function(key){
    var value=Number(design[key]);
    if(Number.isFinite(value))target[key]=Math.max(0,Math.min(100,Math.round(value)));
  });
  if(design.buttonStyle)target.buttonStyle=normalizeButtonStyle(design.buttonStyle);
  v3EnsureDesign(state.project);
}

/* The design slice has to survive the round trip, so the envelope carries it. */
var v2BaseEnvelopeBeforeV4=v2BaseEnvelope;
v2BaseEnvelope=function(project,name,type){
  var out=v2BaseEnvelopeBeforeV4(project,name,type),design=project.design;
  out.concept.design=Object.assign({
    archetype:design.archetype,
    palette:Object.assign({},design.palette),
    fontBody:design.fontBody,
    fontDisplay:design.fontDisplay,
    radius:design.radius,
    buttonStyle:design.buttonStyle
  },DIAL_KEYS.reduce(function(dials,key){dials[key]=design[key];return dials},{}));
  out.customFlows=deepClone((project.customFlows||[]).filter(function(flow){return flow&&flow.custom}));
  return out;
};

/* ---------------------------------------------------------------- *
 * The import control, in the advanced builder's Step 01
 * ---------------------------------------------------------------- */

var renderBriefBeforeV4=renderBrief;
renderBrief=function(){
  var output=renderBriefBeforeV4(),nav=renderEditorNav();
  var importPanel=panel('Start from a simple-builder concept',
    '<div class="panel-note">Bring in a concept JSON exported from the simple builder. The page, navigation, footer, design and all three concepts come across, and the brief fields above are filled in from the paragraph the strategist wrote.</div>'+
    '<div class="import-row"><label class="import-drop"><input type="file" accept="application/json,.json" data-concept-import>'+
    '<b>Choose a concept JSON</b><span>or drag the file here</span></label></div>',
    'Simple → Advanced');
  return nav&&output.slice(-nav.length)===nav?output.slice(0,-nav.length)+importPanel+nav:output+importPanel;
};

byId('editorInner').addEventListener('change',function(event){
  var input=event.target.closest('[data-concept-import]');
  if(!input||!input.files||!input.files[0])return;
  var file=input.files[0];
  input.value='';
  v4ImportConcept(file);
});

byId('editorInner').addEventListener('dragover',function(event){
  if(!event.target.closest('.import-drop'))return;
  event.preventDefault();
  event.target.closest('.import-drop').classList.add('is-over');
});
byId('editorInner').addEventListener('dragleave',function(event){
  var drop=event.target.closest('.import-drop');
  if(drop)drop.classList.remove('is-over');
});
byId('editorInner').addEventListener('drop',function(event){
  var drop=event.target.closest('.import-drop');
  if(!drop)return;
  event.preventDefault();
  drop.classList.remove('is-over');
  var file=event.dataTransfer&&event.dataTransfer.files&&event.dataTransfer.files[0];
  if(file)v4ImportConcept(file);
});

/* ---------------------------------------------------------------- *
 * Stock imagery
 *
 * The brain finds the pictures; this section decides where a picture can go and
 * puts it there. The page's demand for imagery is a property of the pattern on
 * each section — how many media nodes its tree actually has — so it is derived
 * from the tree rather than guessed from the family name.
 * ---------------------------------------------------------------- */

var MEDIA_SLOT_COMPONENTS=['ds-blocks/l-content-2','ds-blocks/c-media'];

/** Every media slot on one section, in the order syncSectionNode fills them. */
function v5SectionSlots(section){
  if(!section||section.visible===false||!section.node)return [];
  // A portrait has to be the client's own colleague, never a stock model.
  if(isPeopleFamily(section.family))return [];
  var slots=[],node=section.node,label=cleanText(section.content&&section.content.title||'').slice(0,120);
  var add=function(role,index,allowsVideo){slots.push({key:section.id+':'+role+':'+index,sectionId:section.id,family:section.family,role:role,index:index,label:label,allowsVideo:!!allowsVideo})};
  if(node.component==='ds-blocks/dst-banner')add('background',0,true);
  var items=(section.content&&section.content.items)||[],content2=allNodes(node,'ds-blocks/l-content-2').length,cmedia=allNodes(node,'ds-blocks/c-media').length;
  // A c-media node shows an item's picture when the section has items, and the
  // section's own media when it does not. Counting it both ways would spend an
  // asset that is stored and never rendered.
  var features=content2+(items.length?0:cmedia);
  for(var i=0;i<features;i++)add('feature',i,true);
  var cards=firstNode(node,'ds-blocks/c-cards');
  var perItem=cards&&CARD_MEDIA_FAMILIES.indexOf(section.family)>=0
    ? (items.length||(cards.children||[]).length)
    : Math.min(cmedia,items.length);
  for(var j=0;j<Math.min(12,perItem);j++)add('card',j,true);
  return slots;
}

function v5MediaSlots(project){
  return (((project||state.project).sections)||[]).reduce(function(all,section){return all.concat(v5SectionSlots(section))},[]);
}

/**
 * Writes one plan onto the page.
 *
 * Slot order is the contract between this function and `v5SectionSlots`: a
 * background is `content.media[0]`, foreground visuals follow it in the same
 * array, and a card keeps its picture on its own item. Nothing else about the
 * section changes, so the copy, the pattern and the block tree are untouched.
 */
function v5ApplyMediaPlan(plan){
  var assets={},placed=0;
  (plan&&plan.assets||[]).forEach(function(asset){assets[asset.id]=asset});
  var bySection={};
  (plan&&plan.assignments||[]).forEach(function(entry){
    var asset=assets[entry.assetId];
    if(!asset)return;
    var parts=String(entry.slotKey).split(':'),sectionId=parts.slice(0,parts.length-2).join(':'),role=parts[parts.length-2],index=Number(parts[parts.length-1]);
    if(!bySection[sectionId])bySection[sectionId]=[];
    bySection[sectionId].push({role:role,index:index,asset:asset});
  });
  mutate(function(){
    state.project.sections.forEach(function(section){
      var entries=bySection[section.id];
      if(!entries||!entries.length)return;
      v5FillSlots(section,entries,function(slot){
        placed+=1;
        return v5AssetMedia(slot.asset);
      });
    });
    // The caller announces the full result — counts, videos and any slot left
    // on a placeholder — so this mutation stays quiet rather than toasting twice.
  },{message:''});
  return placed;
}

/** Puts the placeholder library back. Only stock media is removed. */
function v5ClearMediaPlan(){
  var removed=0;
  mutate(function(){
    state.project.sections.forEach(function(section){
      var content=section.content||{};
      if(Array.isArray(content.media)){
        content.media=content.media.filter(function(media){
          if(media&&media.provider==='shutterstock'){removed+=1;return false}
          return true;
        });
        if(!content.media.length)delete content.media;
      }
      (content.items||[]).forEach(function(item){
        if(item&&item.media&&item.media.provider==='shutterstock'){delete item.media;removed+=1}
      });
      syncSectionNode(section);
    });
    var media=briefBrainFeature.ensureMediaState(state.project);
    if(media){media.assets=[];media.assignments=[];media.unassigned=[];media.status='idle';media.liveMessage='';media.queries=null;media.generatedAt='';media.generatedFrom=''}
  },{message:'Placeholder imagery restored'});
  return removed;
}

/**
 * Writes one picture into every given slot. Shared by the plan applier and the
 * contract test that proves a claimed slot is a rendered slot.
 */
function v5FillSlots(section,slots,mediaFor){
  section.content=section.content||{};
  var hasBanner=section.node&&section.node.component==='ds-blocks/dst-banner';
  (slots||[]).forEach(function(slot){
    var media=mediaFor(slot);
    if(!media)return;
    if(slot.role==='card'){
      section.content.items=section.content.items||[];
      if(!section.content.items[slot.index])section.content.items[slot.index]={};
      section.content.items[slot.index].media=media;
    }else{
      section.content.media=Array.isArray(section.content.media)?section.content.media:[];
      section.content.media[slot.role==='background'?0:(hasBanner?slot.index+1:slot.index)]=media;
    }
  });
  syncSectionNode(section);
  return section;
}

var v3BrainContextBeforeV5=v3BrainContext;
v3BrainContext=function(){
  var context=v3BrainContextBeforeV5();
  context.mediaSlots=function(){return v5MediaSlots(state.project)};
  context.applyMediaPlan=v5ApplyMediaPlan;
  context.clearMediaPlan=v5ClearMediaPlan;
  return context;
};

// The imagery panel belongs with the modules, in both builders: it is only
// meaningful once there are sections with pictures in them.
function v5WithMediaPanel(output){
  var panelHtml=v3BrainPanel(briefBrainFeature.renderMediaPanel);
  if(!panelHtml)return output;
  // Directly beside the copywriter panel at the top of the step, not buried at
  // the bottom: writing the words and finding the pictures are one decision, and
  // the first is useless to look at while the second is still a placeholder.
  var anchor=output.indexOf('<section class="panel"');
  if(anchor<0){
    var nav=renderEditorNav();
    return nav&&output.slice(-nav.length)===nav?output.slice(0,-nav.length)+panelHtml+nav:output+panelHtml;
  }
  return output.slice(0,anchor)+panelHtml+output.slice(anchor);
}

var renderModulesBeforeV5=renderModules;
renderModules=function(){return v5WithMediaPanel(renderModulesBeforeV5())};

var v4SimpleModulesBeforeV5=v4SimpleModules;
v4SimpleModules=function(){return v5WithMediaPanel(v4SimpleModulesBeforeV5())};

/* ---------------------------------------------------------------- *
 * Module editor · Media
 *
 * The project's own imagery comes first, because once the brain has found
 * pictures for this brief the built-in library is only a fallback. People
 * sections are the exception and say so: a testimonial face has to be the
 * client's colleague, not a stock model.
 * ---------------------------------------------------------------- */

/** One found asset as a media object. The watermark stays a preview until bought. */
function v5AssetMedia(asset){
  return asMedia({src:asset.src,alt:asset.alt,source:'Shutterstock',kind:asset.kind,poster:asset.poster,assetId:asset.assetId,provider:asset.provider,licence:'preview',url:asset.url});
}

function v5ProjectAssets(){
  var media=briefBrainFeature.ensureMediaState(state.project);
  return media&&Array.isArray(media.assets)?media.assets:[];
}

/** Asset ids already on the page, so the picker can show what is spare. */
function v5UsedAssetIds(){
  var used={};
  (state.project.sections||[]).forEach(function(section){
    var content=section.content||{};
    (Array.isArray(content.media)?content.media:[]).forEach(function(m){if(m&&m.assetId)used[m.assetId]=true});
    (content.items||[]).forEach(function(item){if(item&&item.media&&item.media.assetId)used[item.media.assetId]=true});
  });
  return used;
}

function v5AssetButton(asset,current,used){
  var thumb=asset.thumb||asset.poster||asset.src,selected=current&&current.assetId===asset.assetId;
  // The id is the only thing on this tile that survives past the concept: it is
  // what somebody types into Shutterstock to actually buy the picture.
  return '<button class="media-option'+(selected?' selected':'')+(used[asset.assetId]&&!selected?' is-used':'')+'" data-project-media="'+escAttr(asset.id)+'" title="'+escAttr(asset.alt)+(asset.assetId?' · Shutterstock #'+asset.assetId:'')+'">'+
    '<img loading="lazy" src="'+escAttr(thumb)+'" alt="">'+
    '<span>'+(asset.assetId?'#'+esc(asset.assetId):(asset.kind==='video'?'video':'image'))+(used[asset.assetId]&&!selected?' · in use':'')+'</span></button>';
}

/**
 * The licence line for whatever picture is in a slot right now.
 *
 * A watermarked comp is only useful if the person holding the page can get from
 * it back to the asset that has to be bought, so the id and the shop link travel
 * with the slot rather than living only in the imagery panel above.
 */
function v7SlotLicence(media){
  if(!media||!media.assetId)return '';
  var url=briefBrainFeature.assetPurchaseUrl?briefBrainFeature.assetPurchaseUrl(media):(media.licenceUrl||'');
  return '<div class="media-slot__licence">'+
    '<button type="button" class="media-slot__id" data-brain-action="copy-asset-id" data-brain-asset-id="'+escAttr(media.assetId)+'" title="Copy this Shutterstock id">'+
      esc((media.provider==='shutterstock'?'Shutterstock ':'')+'#'+media.assetId)+'</button>'+
    (url?'<a href="'+escAttr(url)+'" target="_blank" rel="noreferrer noopener">Licence this asset</a>':'')+
    '<span class="media-slot__licence-state">'+esc(media.licence==='licensed'?'Licensed':'Watermarked preview')+'</span>'+
  '</div>';
}

var renderMediaEditorBeforeV5=renderMediaEditor;
renderMediaEditor=function(section){
  var base=renderMediaEditorBeforeV5(section);
  var people=isPeopleFamily(section.family);
  var assets=v5ProjectAssets();
  var current=(section.content.media&&section.content.media[0])||(section.content.items&&section.content.items[0]&&section.content.items[0].media)||{};
  if(people){
    return '<div class="panel-note is-people">These are people, so they stay on the placeholder library. Replace them with the client\'s own photographs of their own colleagues before this page goes anywhere near a client — a stock face on a testimonial is worse than no face.</div>'+base;
  }
  if(!assets.length){
    return '<div class="panel-note">No project imagery yet. Use <b>Find imagery</b> below to search the stock library for this brief; until then this module uses the built-in placeholder set.</div>'+base;
  }
  var used=v5UsedAssetIds();
  return '<div class="panel-note">Imagery found for this brief. These are watermarked previews for client review — license the ones you keep before publishing. Picking one here replaces this module\'s main visual.</div>'+
    '<div class="media-picker">'+assets.map(function(asset){return v5AssetButton(asset,current,used)}).join('')+'</div>'+
    '<details class="media-fallback"><summary>Placeholder library</summary>'+base+'</details>';
};

byId('editorInner').addEventListener('click',function(event){
  var trigger=event.target.closest('[data-project-media]');
  if(!trigger)return;
  var asset=v5ProjectAssets().find(function(entry){return entry.id===trigger.dataset.projectMedia});
  var section=state.project.sections.find(function(entry){return entry.id===state.selectedSectionId});
  if(!asset||!section)return;
  var media=v5AssetMedia(asset);
  // A picker inside a slot row targets that slot; the header picker still means
  // "this module's main visual", which is what it has always meant.
  var slot=trigger.dataset.slotKey?v5SectionSlots(section).find(function(entry){return entry.key===trigger.dataset.slotKey}):null;
  mutate(function(){
    if(slot){v7SetSlotMedia(section,slot,media);return}
    section.content=section.content||{};
    section.content.media=Array.isArray(section.content.media)?section.content.media:[];
    section.content.media[0]=media;
  },{message:asset.kind==='video'?'Video placed on this module':'Image placed on this module'});
  v11PaintInPlace(section);
});

/* ================================================================== *
 * v7 — Media slots hold moving pictures too
 *
 * A DST card, a content-2 split and a banner background all render through the
 * same `v2RenderMedia`, which has always known how to emit a muted looping
 * `<video>`. What was missing was any way to *say* so: the editor exposed one
 * "custom image URL" that wrote the section's first slot and assumed a still.
 *
 * So every rendered slot is now editable in its own right — source, kind, alt
 * text and, for a clip, a poster — using exactly the slot list the stock-imagery
 * job already fills. That list is the contract: if the brain can put a picture
 * there, a strategist can put a clip there, and neither can address a slot the
 * pattern does not actually render.
 * ================================================================== */

/** Where one slot's media lives in `section.content`. Mirrors `v5FillSlots`. */
function v7SlotAddress(section,slot){
  if(slot.role==='card')return {kind:'item',index:slot.index};
  var hasBanner=section.node&&section.node.component==='ds-blocks/dst-banner';
  return {kind:'media',index:slot.role==='background'?0:(hasBanner?slot.index+1:slot.index)};
}

function v7SlotMedia(section,slot){
  var at=v7SlotAddress(section,slot),content=section.content||{};
  if(at.kind==='item'){var item=(content.items||[])[at.index];return item&&item.media||null}
  return (Array.isArray(content.media)?content.media:[])[at.index]||null;
}

function v7SetSlotMedia(section,slot,media){
  var at=v7SlotAddress(section,slot);
  section.content=section.content||{};
  if(at.kind==='item'){
    section.content.items=section.content.items||[];
    if(!section.content.items[at.index])section.content.items[at.index]={};
    section.content.items[at.index].media=media;
  }else{
    section.content.media=Array.isArray(section.content.media)?section.content.media:[];
    section.content.media[at.index]=media;
  }
  syncSectionNode(section);
  return media;
}

/** Applies one changed field to a slot, keeping everything else about it. */
function v7PatchSlotMedia(section,slot,key,value){
  var current=v7SlotMedia(section,slot)||{},next=Object.assign({},current);
  if(key==='kind')next.kind=value==='video'?'video':'image';
  else next[key]=value;
  // A URL that plainly names a clip is a clip, whatever the select last said —
  // pasting an .mp4 and then having to also change a dropdown is a papercut.
  if(key==='src'&&isVideoMedia({src:value}))next.kind='video';
  if(!next.src)return v7SetSlotMedia(section,slot,null);
  if(!next.source)next.source='user-provided';
  if(next.kind!=='video')delete next.poster;
  return v7SetSlotMedia(section,slot,asMedia(next));
}

var V7_SLOT_LABELS={background:'Background',feature:'Feature visual',card:'Card'};
function v7SlotLabel(slot,slots){
  var base=V7_SLOT_LABELS[slot.role]||'Visual',
    siblings=slots.filter(function(entry){return entry.role===slot.role}).length;
  return siblings>1?base+' '+(slot.index+1):base;
}

/** The thumbnail for a slot row: the poster for a clip, the picture otherwise. */
function v7SlotThumb(media){
  var src=media&&(media.kind==='video'?(media.poster||''):media.src);
  if(src)return '<img loading="lazy" src="'+escAttr(src)+'" alt="">';
  if(media&&media.kind==='video')return '<span class="media-slot__glyph" aria-hidden="true">▶</span>';
  return '<span class="media-slot__glyph" aria-hidden="true">◇</span>';
}

function v7SlotRow(section,slot,slots,assets,used){
  var media=v7SlotMedia(section,slot)||{},video=media.kind==='video';
  return '<div class="media-slot'+(video?' is-video':'')+'" data-slot-key="'+escAttr(slot.key)+'">'+
    '<div class="media-slot__head">'+
      '<span class="media-slot__thumb">'+v7SlotThumb(media)+'</span>'+
      '<b>'+esc(v7SlotLabel(slot,slots))+'</b>'+
      '<span class="media-slot__kind">'+(video?'Video':media.src?'Image':'Empty')+'</span>'+
    '</div>'+
    v7SlotLicence(media)+
    '<div class="field-grid">'+
      '<div class="field"><label>Type</label><select data-slot-media="'+escAttr(slot.key)+'" data-key="kind">'+
        '<option value="image"'+(video?'':' selected')+'>Image</option>'+
        '<option value="video"'+(video?' selected':'')+'>Video</option>'+
      '</select></div>'+
      '<div class="field"><label>'+(video?'Video URL (mp4)':'Image URL')+'</label><input type="text" data-slot-media="'+escAttr(slot.key)+'" data-key="src" value="'+escAttr(media.src||'')+'" placeholder="https://…"></div>'+
      '<div class="field full"><label>'+(video?'Description (aria-label)':'Alt text')+'</label><input type="text" data-slot-media="'+escAttr(slot.key)+'" data-key="alt" value="'+escAttr(media.alt||'')+'" placeholder="What is in the shot"></div>'+
      (video?'<div class="field full"><label>Poster image URL</label><input type="text" data-slot-media="'+escAttr(slot.key)+'" data-key="poster" value="'+escAttr(media.poster||'')+'" placeholder="Shown until the clip has buffered"><div class="field-help">A clip that has not loaded must not be a hole in the page.</div></div>':'')+
    '</div>'+
    (assets.length||DATA.media.length
      ? '<details class="media-slot__pick"><summary>Choose from the library</summary><div class="media-picker">'+
        assets.map(function(asset){return v5AssetButton(asset,media,used).replace('data-project-media=','data-slot-key="'+escAttr(slot.key)+'" data-project-media=')}).join('')+
        DATA.media.map(function(entry,index){
          return '<button class="media-option'+(entry.src===media.src?' selected':'')+'" data-slot-key="'+escAttr(slot.key)+'" data-slot-library="'+index+'" title="'+escAttr(entry.alt)+'"><img loading="lazy" src="'+escAttr(entry.src)+'" alt=""><span>'+esc(entry.group||'media')+'</span></button>';
        }).join('')+
      '</div></details>'
      : '')+
  '</div>';
}

function v7SlotEditor(section){
  var slots=v5SectionSlots(section);
  if(!slots.length)return '';
  var assets=v5ProjectAssets(),used=v5UsedAssetIds();
  return '<div class="global-section-title"><b>Media slots on this module</b><small>'+slots.length+' rendered slot'+(slots.length===1?'':'s')+'</small></div>'+
    '<div class="panel-note">Every slot this pattern actually renders. Any of them takes a still or a muted looping clip — the same markup the WordPress importer expects, so a video here is a video there.</div>'+
    '<div class="media-slots">'+slots.map(function(slot){return v7SlotRow(section,slot,slots,assets,used)}).join('')+'</div>';
}

var renderMediaEditorBeforeV7=renderMediaEditor;
renderMediaEditor=function(section){
  // People keep the placeholder library and the warning that goes with it: a
  // stock face on a testimonial is the one substitution that must not be easy.
  if(isPeopleFamily(section.family))return renderMediaEditorBeforeV7(section);
  return renderMediaEditorBeforeV7(section)+v7SlotEditor(section);
};

byId('editorInner').addEventListener('input',function(event){
  var input=event.target;
  if(!input.dataset||!input.dataset.slotMedia)return;
  var section=state.project.sections.find(function(entry){return entry.id===state.selectedSectionId});
  if(!section)return;
  var slot=v5SectionSlots(section).find(function(entry){return entry.key===input.dataset.slotMedia});
  if(!slot)return;
  inputCheckpoint();
  var before=(v7SlotMedia(section,slot)||{}).kind||'image';
  v7PatchSlotMedia(section,slot,input.dataset.key,input.value);
  queueSave();
  queuePreview();
  // The row changes shape when a slot becomes a clip — a poster field appears,
  // the labels change — and that transition is the only thing worth rebuilding
  // the panel for. Rebuilding on every keystroke, or on every committed edit,
  // would take the field away from under the cursor mid-sentence.
  var after=(v7SlotMedia(section,slot)||{}).kind||'image';
  if(before!==after)renderEditor();
});

byId('editorInner').addEventListener('click',function(event){
  var trigger=event.target.closest('[data-slot-library]');
  if(!trigger)return;
  var section=state.project.sections.find(function(entry){return entry.id===state.selectedSectionId});
  if(!section)return;
  var slot=v5SectionSlots(section).find(function(entry){return entry.key===trigger.dataset.slotKey});
  var choice=DATA.media[Number(trigger.dataset.slotLibrary)];
  if(!slot||!choice)return;
  mutate(function(){v7SetSlotMedia(section,slot,asMedia(choice))},{message:'Placeholder placed on this slot'});
  v11PaintInPlace(section);
});

/* ---------------------------------------------------------------- *
 * Mode-aware guards on the shared machinery
 * ---------------------------------------------------------------- */

var renderLayoutEditorBeforeV4=renderLayoutEditor;
renderLayoutEditor=function(section){
  // The extended view is an advanced-builder affordance regardless of the
  // persisted preference.
  if(v4IsSimple())return v3SimpleLayoutEditor(section);
  return renderLayoutEditorBeforeV4(section);
};

var updateBindingBeforeV4=updateBinding;
updateBinding=function(path,value,input){
  var result=updateBindingBeforeV4(path,value,input);
  if(/^design\./.test(String(path||'')))v4CaptureConceptEdit();
  return result;
};

/*
 * The outermost binding wrapper, so a slider's position is translated into the
 * value the attribute stores before any other handler sees it. It has to be last
 * in the chain for the same reason: every layer below expects a real value —
 * `0.6`, `6px`, `3rem` — not a slider step.
 */
var updateBindingBeforeRange=updateBinding;
updateBinding=function(path,value,input){
  if(!input||!input.dataset||input.dataset.rangeScale==null)return updateBindingBeforeRange(path,value,input);
  var opts=rangeOptionsFrom(input),result=updateBindingBeforeRange(path,rangeStoredValue(value,opts),input);
  // After the call, not before: the layers below patch a range input's `<output>`
  // with the raw value, and this is the one that should win.
  var out=input.closest('.range-field');
  out=out&&out.querySelector('output');
  if(out)out.textContent=rangeDisplay(value,opts);
  return result;
};

byId('editorInner').addEventListener('click',function(event){
  if(event.target.closest('[data-dial-preset]')||event.target.closest('[data-button-style-id]'))v4CaptureConceptEdit();
},false);
byId('editorInner').addEventListener('change',function(event){
  if(event.target.closest('[data-button-style-id]'))v4CaptureConceptEdit();
},false);

/*
 * Step navigation is intercepted at the document, in the capture phase, because
 * the original handler wraps using the advanced builder's five-step length and
 * would overshoot the simple builder's four.
 */
document.addEventListener('click',function(event){
  var trigger=event.target.closest&&event.target.closest('[data-nav]');
  if(!trigger||trigger.disabled)return;
  event.stopPropagation();
  event.preventDefault();
  var count=v4StepCount();
  var next=trigger.dataset.nav==='next'
    ?(state.currentStep===count-1?0:state.currentStep+1)
    :state.currentStep-1;
  goStep(next);
},true);

/* ---------------------------------------------------------------- *
 * Navigation: the menu toggle and the mobile takeover
 * ---------------------------------------------------------------- */

/*
 * The toggle was invisible on every palette, for a reason that is easy to miss:
 * it is a `<button>`, and a button does not inherit `color` — the user-agent
 * `buttontext` keyword wins. So `background:currentColor` on the bars resolved to
 * pure black regardless of the theme, which is black-on-near-black on any dark
 * palette. On top of that the bars were 1px hairlines, so even where the colour
 * happened to contrast they read as a smudge.
 *
 * The colour is now chosen by measured contrast against the canvas the header
 * actually sits on: the palette's dark tone on a light canvas, white on a dark
 * one. That is a computation rather than a guess, so it holds for all thirteen
 * archetypes and for any hand-edited palette.
 */

function v5ContrastRatio(a, b) {
  var la = relativeLum(a), lb = relativeLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The better-contrasting of the palette's dark tone and white, on `ground`. */
function v5OnGround(palette, ground) {
  return v5ContrastRatio(palette.dark, ground) >= v5ContrastRatio('#ffffff', ground)
    ? palette.dark
    : '#ffffff';
}

/*
 * The three alternative takeovers.
 *
 * Everything above this is the shared machine: full screen, pinned brand, pinned
 * close, staggered arrival. These rules only re-compose what is inside it, which
 * is why a variant is a data attribute on the header and never a second markup
 * path — the same `<nav>` serves all four, and the exported site behaves exactly
 * as the preview does.
 *
 * Emitted unconditionally rather than only for the chosen style, because the
 * stylesheet is built once per project while the attribute changes on every
 * click of the select: gating the CSS would mean rebuilding the theme to see a
 * choice that is otherwise instant.
 */
function v5MobileMenuVariantCss(p) {
  var open = '#sbs-site .site-header.menu-open',
    at = function (style) { return '#sbs-site .site-header[data-mobile-menu="' + style + '"].menu-open'; },
    // The aurora ground is the palette's dark tone whatever the page canvas is,
    // so its type colour is measured against that and not against the canvas.
    onAurora = v5OnGround(p, p.dark);

  return '\n' +
    /* The running number is opt-in per variant, so the shared rule hides it. */
    open + ' .nav-menu a::before{content:attr(data-nav-index);display:none}\n' +
    open + ' .nav-menu__label{position:relative;z-index:1}\n' +

    /* --- Left: a contents page. Numbers lead, rules separate, type is flush. --- */
    at('left') + ' .site-header__row{align-items:stretch}\n' +
    at('left') + ' .nav-menu{align-items:stretch;max-width:52rem;text-align:left}\n' +
    at('left') + ' .nav-menu a{display:flex;align-items:baseline;gap:1.4rem;text-align:left;' +
      'padding-bottom:clamp(1rem,2vh,1.8rem);border-bottom:1px solid color-mix(in srgb,var(--sbs-nav-on-overlay) 16%,transparent)}\n' +
    at('left') + ' .nav-menu a:last-child{border-bottom:0}\n' +
    at('left') + ' .nav-menu a::before{display:block;flex:0 0 auto;font-family:var(--dst--font-primary);' +
      'font-size:1.2rem;font-weight:600;letter-spacing:.14em;opacity:.5}\n' +
    at('left') + ' .nav-menu a:hover::before,' + at('left') + ' .nav-menu a:focus-visible::before{opacity:1}\n' +
    at('left') + ' .sbs-header-cta{align-self:flex-start}\n' +

    /* --- Right: the same idea mirrored, weighted toward the thumb. --- */
    at('right') + ' .site-header__row{align-items:stretch}\n' +
    at('right') + ' .nav-menu{align-items:stretch;max-width:52rem;text-align:right}\n' +
    at('right') + ' .nav-menu a{display:flex;align-items:baseline;justify-content:flex-end;gap:1.4rem;text-align:right;' +
      'padding-bottom:clamp(1rem,2vh,1.8rem);border-bottom:1px solid color-mix(in srgb,var(--sbs-nav-on-overlay) 16%,transparent)}\n' +
    at('right') + ' .nav-menu a:last-child{border-bottom:0}\n' +
    at('right') + ' .nav-menu a::before{display:block;order:2;flex:0 0 auto;font-family:var(--dst--font-primary);' +
      'font-size:1.2rem;font-weight:600;letter-spacing:.14em;opacity:.5}\n' +
    at('right') + ' .nav-menu a:hover::before,' + at('right') + ' .nav-menu a:focus-visible::before{opacity:1}\n' +
    at('right') + ' .sbs-header-cta{align-self:flex-end}\n' +

    /* --- Aurora: the expressive one ---------------------------------------
     * A tinted field rather than a flat panel, opened with a circular wipe from
     * the toggle itself so the menu reads as growing out of the control that was
     * pressed. Each link is a full-width target that fills on touch, which is
     * both the flourish and the reason it is easier to hit than centred text.
     */
    at('aurora') + ' .site-header__row{align-items:stretch;color:' + onAurora + ';' +
      'background:' + p.dark + ';' +
      'background-image:' +
        'radial-gradient(120% 80% at 82% 4%,color-mix(in srgb,' + p.accent + ' 62%,transparent) 0%,transparent 62%),' +
        'radial-gradient(100% 70% at 6% 96%,color-mix(in srgb,' + p.soft + ' 46%,transparent) 0%,transparent 58%),' +
        'linear-gradient(160deg,color-mix(in srgb,' + p.dark + ' 92%,' + p.accent + ') 0%,' + p.dark + ' 58%);' +
      '-webkit-clip-path:circle(var(--sbs-nav-wipe,150%) at calc(100% - 3.8rem) calc(var(--dst--header-height) / 2));' +
      'clip-path:circle(var(--sbs-nav-wipe,150%) at calc(100% - 3.8rem) calc(var(--dst--header-height) / 2));' +
      'animation:sbs-nav-aurora var(--sbs-nav-menu-dur) var(--sbs-motion-ease) both}\n' +
    '@keyframes sbs-nav-aurora{from{--sbs-nav-wipe:0%;opacity:.4}to{--sbs-nav-wipe:150%;opacity:1}}\n' +
    at('aurora') + ' .site-header__logo,' + at('aurora') + ' .sbs-menu-toggle{color:' + onAurora + '}\n' +
    at('aurora') + ' .nav-menu{align-items:stretch;max-width:56rem;text-align:left;gap:.4rem}\n' +
    at('aurora') + ' .nav-menu a{position:relative;display:flex;align-items:center;gap:1.6rem;overflow:hidden;' +
      'color:' + onAurora + ';text-align:left;padding:clamp(.8rem,1.8vh,1.6rem) 1.6rem;border-radius:var(--dst--default-radius);' +
      'font-size:clamp(3.2rem,9vw,5.6rem);font-weight:700;' +
      'transition:color var(--sbs-nav-dur) var(--sbs-motion-ease),padding-left var(--sbs-nav-dur) var(--sbs-motion-ease)}\n' +
    /* The fill is its own layer so the label can sit above it and invert. */
    at('aurora') + ' .nav-menu a::after{content:"";position:absolute;inset:0;z-index:0;border-radius:inherit;' +
      'background:' + p.accent + ';transform:scaleX(0);transform-origin:left center;' +
      'transition:transform var(--sbs-nav-dur) var(--sbs-motion-ease)}\n' +
    at('aurora') + ' .nav-menu a:hover::after,' + at('aurora') + ' .nav-menu a:focus-visible::after,' + at('aurora') + ' .nav-menu a:active::after{transform:scaleX(1)}\n' +
    at('aurora') + ' .nav-menu a:hover,' + at('aurora') + ' .nav-menu a:focus-visible{color:' + v5OnGround(p, p.accent) + ';padding-left:2.4rem}\n' +
    at('aurora') + ' .nav-menu a::before{display:block;position:relative;z-index:1;flex:0 0 auto;' +
      'font-family:var(--dst--font-primary);font-size:1.1rem;font-weight:700;letter-spacing:.16em;opacity:.55;' +
      'align-self:flex-start;margin-top:1.2rem}\n' +
    /* A blurred rise rather than a plain one: the flourish that dates the thing. */
    at('aurora') + ' .nav-menu a{animation-name:sbs-nav-aurora-item}\n' +
    '@keyframes sbs-nav-aurora-item{from{opacity:0;transform:translateY(2.4rem) scale(.94);filter:blur(6px)}to{opacity:1;transform:none;filter:blur(0)}}\n' +
    at('aurora') + ' .sbs-header-cta{align-self:flex-start}\n';
}

function v5NavigationCss(project) {
  var p = project.design.palette;
  var onHeader = v5OnGround(p, p.bg);
  // The overlay is the canvas, so its text is the ink the preflight contrast
  // gate already checks — no second colour system to keep in sync.
  var onOverlay = v5ContrastRatio(p.ink, p.bg) >= 4.5 ? p.ink : v5OnGround(p, p.bg);
  var motion = clamp(Number(project.design.motion) || 0, 0, 100) / 100;
  var duration = motion < 0.05 ? '0s' : (0.24 + 0.2 * motion).toFixed(2) + 's';
  var menuDuration = motion < 0.05 ? '0s' : (0.3 + 0.24 * motion).toFixed(2) + 's';

  return '\n' +
    /* Registered so the aurora wipe can be animated at all: an unregistered
       custom property is a string to the animation engine and would jump. Top
       level on purpose — `@property` is not valid inside a media query. */
    '@property --sbs-nav-wipe{syntax:"<percentage>";inherits:false;initial-value:150%}\n' +
    '#sbs-site.ver{--sbs-nav-dur:' + duration + ';--sbs-nav-menu-dur:' + menuDuration + ';--sbs-nav-on-header:' + onHeader + ';--sbs-nav-on-overlay:' + onOverlay + '}\n' +

    /* --- The toggle: a real 44px target with three visible bars --- */
    '#sbs-site .sbs-menu-toggle{position:relative;width:4.4rem;height:4.4rem;flex:0 0 4.4rem;margin-left:auto;padding:0;border:0;background:transparent;cursor:pointer;' +
      /* Set explicitly: a button ignores inherited colour, which is the whole bug. */
      'color:var(--sbs-nav-on-header);-webkit-appearance:none;appearance:none;border-radius:var(--dst--default-radius);z-index:130}\n' +
    '#sbs-site .sbs-menu-toggle:focus-visible{outline:2px solid var(--dst--primary-color2);outline-offset:2px}\n' +
    '#sbs-site .sbs-menu-toggle span{position:absolute;left:50%;top:50%;width:2.4rem;height:2px;margin:-1px 0 0 -1.2rem;background:currentColor;border-radius:2px;' +
      'transition:transform var(--sbs-nav-dur) var(--sbs-motion-ease),opacity var(--sbs-nav-dur) var(--sbs-motion-ease),width var(--sbs-nav-dur) var(--sbs-motion-ease)}\n' +
    '#sbs-site .sbs-menu-toggle span:nth-child(1){transform:translateY(-7px)}\n' +
    '#sbs-site .sbs-menu-toggle span:nth-child(3){transform:translateY(7px)}\n' +
    /* A small spread on hover: enough to read as interactive, not enough to fidget. */
    '#sbs-site .sbs-menu-toggle:hover span:nth-child(1){transform:translateY(-9px)}\n' +
    '#sbs-site .sbs-menu-toggle:hover span:nth-child(3){transform:translateY(9px)}\n' +
    '#sbs-site .sbs-menu-toggle:hover span:nth-child(2){width:1.7rem}\n' +
    /* Open: the outer bars cross, the middle one gets out of the way. */
    '#sbs-site .site-header.menu-open .sbs-menu-toggle{color:var(--sbs-nav-on-overlay)}\n' +
    '#sbs-site .site-header.menu-open .sbs-menu-toggle span:nth-child(1),#sbs-site .site-header.menu-open .sbs-menu-toggle:hover span:nth-child(1){transform:translateY(0) rotate(45deg)}\n' +
    '#sbs-site .site-header.menu-open .sbs-menu-toggle span:nth-child(2),#sbs-site .site-header.menu-open .sbs-menu-toggle:hover span:nth-child(2){opacity:0;transform:scaleX(.2)}\n' +
    '#sbs-site .site-header.menu-open .sbs-menu-toggle span:nth-child(3),#sbs-site .site-header.menu-open .sbs-menu-toggle:hover span:nth-child(3){transform:translateY(0) rotate(-45deg)}\n' +
    /* A custom sticky colour has to reach the toggle too. */
    '#sbs-site .site-header.is-stuck[style*="--hdr-sticky-c"] .sbs-menu-toggle{color:var(--hdr-sticky-c)}\n' +

    '@media(max-width:900px){\n' +
      /* --- The takeover: the whole screen, centred --- */
      '#sbs-site .site-header.menu-open{position:fixed;inset:0;z-index:120;background:transparent;border-bottom:0}\n' +
      '#sbs-site .site-header.menu-open .site-header__row{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'gap:clamp(2.4rem,5vh,4.8rem);margin:0;max-width:none;overflow-y:auto;overscroll-behavior:contain;' +
        'padding:calc(var(--dst--header-height) + 2rem) 2.4rem max(4rem,env(safe-area-inset-bottom));' +
        'background:' + p.bg + ';color:var(--sbs-nav-on-overlay);' +
        'animation:sbs-nav-in var(--sbs-nav-menu-dur) var(--sbs-motion-ease) both}\n' +
      '@keyframes sbs-nav-in{from{opacity:0}to{opacity:1}}\n' +
      /* The brand and the close control stay where they were, at the top. */
      '#sbs-site .site-header.menu-open .site-header__logo{position:fixed;top:calc(var(--dst--header-height) / 2);left:2.4rem;transform:translateY(-50%);margin:0;color:var(--sbs-nav-on-overlay);z-index:130}\n' +
      '#sbs-site .site-header.menu-open .sbs-menu-toggle{position:fixed;top:calc(var(--dst--header-height) / 2);right:1.6rem;transform:translateY(-50%);margin:0}\n' +
      '#sbs-site .site-header.menu-open .site-header__ann{display:none}\n' +

      /* --- The links: centred, clamped, and one at a time --- */
      '#sbs-site .site-header.menu-open .nav-menu{display:flex;position:static;flex-direction:column;align-items:center;justify-content:center;' +
        'gap:clamp(1.2rem,2.6vh,2.4rem);width:100%;max-width:44rem;margin:0;padding:0;background:transparent;border:0;text-align:center}\n' +
      '#sbs-site .site-header.menu-open .nav-menu a{display:block;width:100%;color:var(--sbs-nav-on-overlay);' +
        'font-family:var(--dst--font-secondary);font-size:clamp(2.8rem,7.2vw,4.8rem);line-height:1.08;font-weight:600;' +
        'letter-spacing:var(--sbs-title-tracking,-.02em);text-decoration:none;' +
        'transition:color var(--sbs-nav-dur) var(--sbs-motion-ease),transform var(--sbs-nav-dur) var(--sbs-motion-ease)}\n' +
      '#sbs-site .site-header.menu-open .nav-menu a:hover,#sbs-site .site-header.menu-open .nav-menu a:focus-visible{color:var(--dst--primary-color2)}\n' +
      /* Each link arrives just after the one above it. */
      [1, 2, 3, 4, 5, 6, 7, 8].map(function (index) {
        return '#sbs-site .site-header.menu-open .nav-menu a:nth-child(' + index + '){animation:sbs-nav-item var(--sbs-nav-menu-dur) var(--sbs-motion-ease) both;animation-delay:calc(var(--sbs-nav-menu-dur) * ' + (0.25 + index * 0.09).toFixed(2) + ')}';
      }).join('\n') + '\n' +
      '@keyframes sbs-nav-item{from{opacity:0;transform:translateY(1.4rem)}to{opacity:1;transform:none}}\n' +

      /* --- The action belongs in the menu, not hidden behind it --- */
      '#sbs-site .site-header.menu-open .sbs-header-cta{display:inline-flex;margin:0;font-size:1.7rem;padding:1.5rem 3.2rem;' +
        'animation:sbs-nav-item var(--sbs-nav-menu-dur) var(--sbs-motion-ease) both;animation-delay:calc(var(--sbs-nav-menu-dur) * 1.1)}\n' +

      v5MobileMenuVariantCss(p) +
    '}\n' +

    '@media(prefers-reduced-motion:reduce){' +
      '#sbs-site .sbs-menu-toggle span{transition:none}' +
      '#sbs-site .site-header.menu-open .site-header__row,#sbs-site .site-header.menu-open .nav-menu a,#sbs-site .site-header.menu-open .sbs-header-cta{animation:none}' +
      // The wipe is the animation; with none running, the panel has to open flat
      // rather than stay clipped to its start radius.
      '#sbs-site .site-header[data-mobile-menu="aurora"].menu-open .site-header__row{-webkit-clip-path:none;clip-path:none}' +
      '#sbs-site .site-header[data-mobile-menu="aurora"].menu-open .nav-menu a{filter:none}' +
    '}\n';
}

/* ---------------------------------------------------------------- *
 * The two global parts, painted by hand
 *
 * Navigation and footer are the only bands on the page that are not modules, so
 * they are the only ones the archetype cannot be overruled on module-by-module.
 * These overrides fill that gap: a background with a real opacity control — a
 * navigation that sits over a hero wants to be 70% of the canvas, not 90% — and
 * a colour for each role that carries a colour.
 *
 * Every value is opt-in. An empty string means "follow the palette", so a
 * project that never opens these controls behaves exactly as it did, and a
 * change of archetype still restyles everything that was not deliberately
 * pinned.
 * ---------------------------------------------------------------- */

/** `#rrggbb` at `percent` opacity, as a colour the browser will accept. */
function v7Alpha(color,percent){
  return 'color-mix(in srgb,'+color+' '+clamp(Math.round(percent),0,100)+'%,transparent)';
}

function v7GlobalChromeCss(project){
  var h=project.header||{},f=project.footer||{},p=project.design.palette,out=[];
  var headerBg=cleanText(h.bgColor)||p.bg,
    opacity=Number.isFinite(Number(h.bgOpacity))?clamp(Number(h.bgOpacity),0,100):90,
    // A header that is transparent while scrolling has to become readable once
    // it is stuck over content, so the stuck state keeps the same relative lift
    // the palette version always had.
    stuck=clamp(opacity+7,0,100);
  out.push('#sbs-site .site-header{background:'+v7Alpha(headerBg,opacity)+'}');
  out.push('#sbs-site .site-header.is-stuck{background:'+v7Alpha(headerBg,stuck)+'}');
  if(cleanText(h.borderColor))out.push('#sbs-site .site-header{border-bottom-color:'+h.borderColor+'}');
  if(cleanText(h.textColor)){
    out.push('#sbs-site .site-header,#sbs-site .site-header__logo,#sbs-site .site-header .nav-menu a,#sbs-site .site-header__ann{color:'+h.textColor+'}');
    // The burger is a <button>, which does not inherit colour — the same trap
    // v5NavigationCss exists to work around. Move its token, not just the text.
    out.push('#sbs-site.ver{--sbs-nav-on-header:'+h.textColor+'}');
  }
  if(cleanText(h.linkHoverColor))out.push('#sbs-site .site-header .nav-menu a:hover,#sbs-site .site-header .nav-menu a:focus-visible{color:'+h.linkHoverColor+'}');
  if(cleanText(f.bgColor))out.push('#sbs-site .site-footer{background:'+f.bgColor+'}');
  if(cleanText(f.textColor))out.push('#sbs-site .site-footer,#sbs-site .site-footer p,#sbs-site .site-footer .footer__legal,#sbs-site .site-footer .footer__nl-sub{color:'+f.textColor+'}');
  if(cleanText(f.headingColor))out.push('#sbs-site .site-footer h2,#sbs-site .site-footer h3,#sbs-site .site-footer h4,#sbs-site .site-footer .footer__nl-head,#sbs-site .site-footer .c-heading__pre{color:'+f.headingColor+'}');
  if(cleanText(f.linkColor))out.push('#sbs-site .site-footer .footer__menu a,#sbs-site .site-footer .footer__privacy a{color:'+f.linkColor+'}');
  if(cleanText(f.accentColor)){
    out.push('#sbs-site .site-footer .dst-social{color:'+f.accentColor+';border-color:'+v7Alpha(f.accentColor,55)+'}');
    out.push('#sbs-site .site-footer .footer__wordmark{color:'+v7Alpha(f.accentColor,22)+'}');
  }
  return '\n'+out.join('\n')+'\n';
}

var siteCssBeforeV5 = siteCss;
siteCss = function (project) {
  v3EnsureDesign(project);
  v2EnsureProject(project);
  // Last, so a hand-picked chrome colour wins over both the palette defaults and
  // the navigation contrast rules above.
  return siteCssBeforeV5(project) + v5NavigationCss(project) + v7GlobalChromeCss(project);
};

/*
 * The toggle's own behaviour. A full-screen menu that leaves the page scrolling
 * behind it feels broken, and a control whose label still says "Open" when the
 * menu is open is wrong for anyone using a screen reader.
 */
var siteRuntimeBeforeV5 = siteRuntime;
siteRuntime = function () {
  return siteRuntimeBeforeV5() + '\n(function(){' +
    'var header=document.querySelector(".site-header"),toggle=document.querySelector(".sbs-menu-toggle");' +
    'if(!header||!toggle)return;' +
    'function sync(){' +
      'var open=header.classList.contains("menu-open");' +
      'toggle.setAttribute("aria-expanded",String(open));' +
      'toggle.setAttribute("aria-label",open?"Close navigation":"Open navigation");' +
      'document.documentElement.style.overflow=open?"hidden":"";' +
      'document.body.style.overflow=open?"hidden":"";' +
    '}' +
    'new MutationObserver(sync).observe(header,{attributes:true,attributeFilter:["class"]});' +
    'document.addEventListener("keydown",function(event){' +
      'if(event.key!=="Escape"||!header.classList.contains("menu-open"))return;' +
      'header.classList.remove("menu-open");' +
      'toggle.focus();' +
    '});' +
    'sync();' +
  '})();';
};

/* ================================================================== *
 * v6 — Switching patterns from the preview
 *
 * Choosing a pattern used to mean: select the module in the list, open the
 * modal, read 154 cards, pick one, close, look at the preview, decide, repeat.
 * That is six actions per comparison, and the comparison — the only part that
 * matters — happens across a modal that hides the thing being compared.
 *
 * So the preview itself becomes the control. Hovering a module outlines it and
 * puts one arrow on each edge; pressing an arrow steps to the next registered
 * pattern in that module's family and the module redraws in place. The modal
 * stays exactly where it was, one button away, for when browsing beats stepping.
 *
 * Two things make it feel immediate rather than merely fast:
 *
 *   1. The swapped module is repainted *into the live document* rather than
 *      through a full `srcdoc` rebuild. A rebuild reloads the page, which blanks
 *      the frame and throws away scroll position — fine for a debounced keystroke,
 *      wrong for a control someone presses four times in two seconds.
 *   2. The full rebuild still runs, once, a beat after the last press. It is
 *      what re-binds sliders, tabs and the viewport observers inside the new
 *      markup, so the in-place paint never has to reimplement the site runtime.
 *
 * The overlay lives in the builder's own document, not the preview's, so it
 * stays crisp at any zoom and never reaches the export.
 * ================================================================== */

/* The pointer has to be allowed to travel from the preview onto the overlay's
 * own buttons, which is a leave-then-enter as far as the frame is concerned. */
var V6_HIDE_MS=140;

var v6Hud=null,v6HoverId='',v6HideTimer=null,v6Frame=0,v6BoundDoc=null;

/*
 * The navigation's own controls cannot sit on the navigation — every pixel of it
 * is already a control — so they sit in a strip beside and below it. That strip
 * is drawn over whatever module follows the header, and the pointer has to cross
 * those pixels to reach a button.
 *
 * Without this they belong to that module: one `mousemove` on the hero and the
 * overlay retargets, so the arrows are gone before the pointer arrives. The band
 * the strip occupies therefore reads as part of the header for as long as the
 * header is the thing being described.
 */
var V6_CHROME_GUARD=58;
function v6ChromeGuard(clientY){
  var kind=v6ChromeKind(v6HoverId);
  if(!kind||!v6BoundDoc)return false;
  var node=v6BoundDoc.querySelector(v6ChromePart(kind).selector);
  if(!node)return false;
  // The strip is measured in builder pixels and the event in page pixels, so
  // the reach has to be divided by the shell's scale, not added to it.
  var box=node.getBoundingClientRect(),reach=V6_CHROME_GUARD/(state.zoom||1);
  // Only the header pays for this. The footer's controls sit inside the footer,
  // so guarding it would only cost the module above it its bottom edge.
  if(kind!=='header')return false;
  return clientY>=box.top&&clientY<=box.bottom+reach;
}

/**
 * The header and the footer, addressed the same way a module is.
 *
 * The overlay identifies its target by id. Neither global part has a project
 * id — there is exactly one of each — so they use two reserved sentinels. What
 * a "pattern" is for them is their layout variant, which is why stepping them
 * needs no new interaction: the same arrows, the same keys, the same in-place
 * repaint.
 */
var V6_HEADER='@header',V6_FOOTER='@footer';
function v6ChromeKind(id){return id===V6_HEADER?'header':id===V6_FOOTER?'footer':''}
function v6ChromePart(kind){
  if(kind==='header')return {
    kind:'header',selector:'.site-header',label:'Global navigation',badge:'NAV',catalog:HEADER_VARIANTS,
    value:function(){return headerVariant(state.project.header.variant)},
    set:function(value){state.project.header.variant=headerVariant(value)},
    render:function(){return renderHeader(state.project)}
  };
  if(kind==='footer')return {
    kind:'footer',selector:'.site-footer',label:'Global footer',badge:'FTR',catalog:FOOTER_VARIANTS,
    value:function(){return footerVariant(state.project.footer.variant)},
    set:function(value){state.project.footer.variant=footerVariant(value)},
    render:function(){return renderFooter(state.project)}
  };
  return null;
}
function v6VariantEntry(part){
  var value=part.value();
  return part.catalog.filter(function(entry){return entry.value===value})[0]||part.catalog[0];
}
function v6PatternPool(family){return DATA.patterns.filter(function(p){return p.family===family})}
function v6Section(id){return state.project.sections.find(function(s){return s.id===id})||null}
function v6VisibleSections(){return state.project.sections.filter(function(s){return s.visible!==false})}

/** True when motion is switched off, by the design dial or by the operating system. */
function v6Still(){
  if((Number(state.project.design.motion)||0)<5)return true;
  return !!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function v6BuildHud(){
  if(v6Hud)return v6Hud;
  var host=document.querySelector('.preview');
  if(!host)return null;
  var root=document.createElement('div');
  root.className='pv-hud';
  root.id='previewHud';
  root.hidden=true;
  root.innerHTML=
    '<div class="pv-hud__frame">'+
      '<div class="pv-hud__bar">'+
        '<span class="pv-hud__index"></span>'+
        '<span class="pv-hud__copy"><b></b><span></span></span>'+
        '<span class="pv-hud__count"></span>'+
      '</div>'+
      '<div class="pv-hud__tools"></div>'+
      '<button type="button" class="pv-hud__arrow -prev" data-pv="prev" aria-label="Previous pattern">'+ICONS.arrow+'</button>'+
      '<button type="button" class="pv-hud__arrow -next" data-pv="next" aria-label="Next pattern">'+ICONS.arrow+'</button>'+
      '<span class="pv-hud__hint"></span>'+
    '</div>';
  host.appendChild(root);

  var frame=root.querySelector('.pv-hud__frame');
  // The overlay is part of the preview, so the pointer resting on it must not
  // read as having left the module it is describing.
  frame.addEventListener('mouseenter',function(){clearTimeout(v6HideTimer)});
  frame.addEventListener('mouseleave',function(){v6QueueHide()});
  frame.addEventListener('click',function(event){
    var trigger=event.target.closest('[data-pv]');
    if(!trigger||!v6HoverId)return;
    event.preventDefault();
    var action=trigger.dataset.pv;
    if(action==='prev')v6Step(v6HoverId,-1);
    else if(action==='next')v6Step(v6HoverId,1);
    else if(action==='browse'){v6Select(v6HoverId);openPatternModal('change')}
    else if(action==='edit'){
      var wanted=v6HoverId;
      v6Select(wanted);
      goStep(v4IsSimple()?2:3);
      // After the step has rendered: the panel does not exist to measure until
      // `renderEditor` has run, and the scroll has to start from the top the
      // step reset it to.
      requestAnimationFrame(function(){
        if(v6RevealModuleEditor())announce('Editing '+(v6Section(wanted)?patternLabel(v6Section(wanted)):'this module'));
      });
    }
    else if(action==='mobile')v6StepMobileMenu();
    else if(action==='globals')v6OpenGlobals(v6ChromeKind(v6HoverId));
  });

  v6Hud={
    root:root,frame:frame,
    index:root.querySelector('.pv-hud__index'),
    pattern:root.querySelector('.pv-hud__copy b'),
    family:root.querySelector('.pv-hud__copy span'),
    count:root.querySelector('.pv-hud__count'),
    tools:root.querySelector('.pv-hud__tools'),
    hint:root.querySelector('.pv-hud__hint'),
    prev:root.querySelector('.pv-hud__arrow.-prev'),
    next:root.querySelector('.pv-hud__arrow.-next')
  };
  return v6Hud;
}

/**
 * Maps a module's box inside the preview onto the builder's own coordinates.
 *
 * The device shell is scaled with CSS `zoom`, so a rect measured inside the
 * frame is in unscaled page pixels while the frame's own rect is already
 * scaled — hence the one multiplication. Returns null when the module is not
 * in the document, which is the normal state during a rebuild.
 */
function v6Geometry(sectionId){
  var hud=v6BuildHud(),frame=byId('sitePreview'),stage=document.querySelector('.preview-stage');
  if(!hud||!frame||!stage)return null;
  var doc=null;
  try{doc=frame.contentDocument}catch(error){return null}
  var chrome=v6ChromeKind(sectionId),
    target=doc&&(chrome?doc.querySelector(v6ChromePart(chrome).selector):doc.getElementById(sectionId));
  if(!target)return null;
  var box=target.getBoundingClientRect(),
    frameBox=frame.getBoundingClientRect(),
    // The stage, not the overlay: a hidden overlay measures zero, and the
    // overlay is placed *from* this rect anyway.
    stageBox=stage.getBoundingClientRect(),
    zoom=state.zoom||1;
  if(!box.height||!stageBox.height)return null;
  var top=frameBox.top-stageBox.top+box.top*zoom,
    height=box.height*zoom,
    // The visible slice, so the toolbar and the arrows stay reachable on a
    // module taller than the stage.
    visibleTop=Math.max(0,top),
    visibleBottom=Math.min(stageBox.height,top+height);
  if(visibleBottom-visibleTop<24)return null;
  return {
    left:frameBox.left-stageBox.left+box.left*zoom,
    top:top,
    width:box.width*zoom,
    height:height,
    barTop:visibleTop-top+10,
    centre:(visibleTop+visibleBottom)/2-top,
    stage:stageBox
  };
}

/** Places the overlay's frame over a measured box, clipped to the stage. */
function v6Place(hud,geometry){
  var host=document.querySelector('.preview'),
    hostBox=host?host.getBoundingClientRect():null;
  // The overlay is laid over the stage exactly, so anything drawn outside the
  // stage — a module scrolled half out of view — is clipped rather than
  // floating over the toolbar.
  if(hostBox){
    hud.root.style.left=Math.round(geometry.stage.left-hostBox.left)+'px';
    hud.root.style.top=Math.round(geometry.stage.top-hostBox.top)+'px';
    hud.root.style.width=Math.round(geometry.stage.width)+'px';
    hud.root.style.height=Math.round(geometry.stage.height)+'px';
  }
  hud.frame.style.left=Math.round(geometry.left)+'px';
  hud.frame.style.top=Math.round(geometry.top)+'px';
  hud.frame.style.width=Math.round(geometry.width)+'px';
  hud.frame.style.height=Math.round(geometry.height)+'px';
  // The header's controls stand in one strip; on a phone shell there is not room
  // for the label as well as the arrows and the actions.
  hud.root.classList.toggle('is-narrow',geometry.width<640);
  hud.frame.style.setProperty('--pv-bar',Math.round(geometry.barTop)+'px');
  hud.frame.style.setProperty('--pv-centre',Math.round(geometry.centre)+'px');
}

/** Draws the overlay over `id`, or hides it when the target cannot be measured. */
function v6Paint(id){
  var hud=v6BuildHud();
  if(!hud)return;
  var chrome=v6ChromeKind(id),section=chrome?null:v6Section(id);
  if(!chrome&&!section){v6Hide();return}
  var geometry=v6Geometry(id);
  if(!geometry){v6Hide();return}
  v6Place(hud,geometry);
  if(chrome){
    var part=v6ChromePart(chrome),
      entry=v6VariantEntry(part),
      at=part.catalog.map(function(item){return item.value}).indexOf(entry.value),
      menu=mobileMenuStyle(state.project.header.mobileMenu),
      menuEntry=MOBILE_MENU_STYLES.filter(function(item){return item.value===menu})[0]||MOBILE_MENU_STYLES[0];
    hud.index.textContent=part.badge;
    hud.pattern.textContent=entry.label;
    hud.family.textContent=part.label;
    hud.count.textContent=(at<0?1:at+1)+' / '+part.catalog.length;
    hud.tools.innerHTML=(chrome==='header'
      ?'<button type="button" class="pv-hud__tool" data-pv="mobile" title="'+escAttr(menuEntry.note)+'">Mobile menu · '+esc(menuEntry.short)+'</button>'
      :'')+
      '<button type="button" class="pv-hud__tool -primary" data-pv="globals">Edit '+(chrome==='header'?'navigation':'footer')+'</button>';
    hud.hint.textContent='← → to switch '+(chrome==='header'?'navigation':'footer')+' layout';
    hud.prev.disabled=false;
    hud.next.disabled=false;
    hud.root.classList.remove('is-single');
    hud.root.classList.add('is-chrome');
    // The navigation is 80-odd pixels tall and every one of them is a control —
    // logo, links, the action, the burger. The overlay's own buttons therefore
    // sit outside it rather than on top of it, and which side "outside" is
    // depends on which part this is.
    hud.root.classList.toggle('is-header',chrome==='header');
    hud.root.classList.toggle('is-footer',chrome==='footer');
    hud.root.hidden=false;
    return;
  }
  var pool=v6PatternPool(section.family),
    position=pool.findIndex(function(p){return p.id===section.patternId}),
    order=v6VisibleSections().indexOf(section);
  hud.index.textContent=String((order<0?0:order)+1).padStart(2,'0');
  hud.pattern.textContent=patternLabel(section);
  hud.family.textContent=familyLabels[section.family]||section.family;
  hud.count.textContent=(position<0?1:position+1)+' / '+pool.length;
  hud.tools.innerHTML='<button type="button" class="pv-hud__tool" data-pv="browse">Browse all</button>'+
    '<button type="button" class="pv-hud__tool -primary" data-pv="edit">Edit module</button>';
  hud.hint.textContent='← → to switch pattern';
  var single=pool.length<2;
  hud.prev.disabled=single;
  hud.next.disabled=single;
  hud.root.classList.toggle('is-single',single);
  hud.root.classList.remove('is-chrome');
  hud.root.classList.remove('is-header');
  hud.root.classList.remove('is-footer');
  hud.root.hidden=false;
}

function v6Show(sectionId){
  if(!sectionId)return;
  clearTimeout(v6HideTimer);
  v6HoverId=sectionId;
  v6Paint(sectionId);
}

function v6Hide(){
  v6HoverId='';
  if(v6Hud)v6Hud.root.hidden=true;
}

function v6QueueHide(){
  clearTimeout(v6HideTimer);
  v6HideTimer=setTimeout(v6Hide,V6_HIDE_MS);
}

/** Repositions on the next frame; scroll and resize both fire far faster than layout. */
function v6Track(){
  if(!v6HoverId||v6Frame)return;
  v6Frame=requestAnimationFrame(function(){
    v6Frame=0;
    if(v6HoverId)v6Paint(v6HoverId);
  });
}

/**
 * Scrolls the editor to the module editor and says so.
 *
 * "Edit module" changes step, and a step opens at the top — which is the brief
 * reader, the sequence and the imagery panel before the thing that was asked
 * for. Jumping straight there would leave no clue that the page moved, so the
 * travel is animated unless motion is switched off, and the panel is marked for
 * a moment when it arrives.
 */
function v6RevealModuleEditor(){
  var view=document.querySelector('.editor'),
    target=document.querySelector('#editorInner [data-module-editor]');
  if(!view||!target)return false;
  var top=target.getBoundingClientRect().top-view.getBoundingClientRect().top+view.scrollTop-16;
  // `auto` defers to the stylesheet's own scroll-behavior, which is smooth here;
  // `instant` is the only value that really means no animation.
  view.scrollTo({top:Math.max(0,top),behavior:v6Still()?'instant':'smooth'});
  target.classList.add('is-revealed');
  clearTimeout(v6RevealTimer);
  v6RevealTimer=setTimeout(function(){target.classList.remove('is-revealed')},1400);
  return true;
}
var v6RevealTimer=null;

function v6Select(sectionId){
  if(!sectionId||v6ChromeKind(sectionId)||state.selectedSectionId===sectionId)return;
  state.selectedSectionId=sectionId;
  state.editorTab='content';
  queueSave();
  renderEditor();
}

/**
 * Repaints one module inside the live preview document.
 *
 * Returns false when the frame is not in a state to be patched — mid-rebuild,
 * or the module is missing — and the caller falls back to a full rebuild.
 */
function v6RepaintSection(section){
  var frame=byId('sitePreview'),doc=null,view=null;
  try{doc=frame&&frame.contentDocument;view=frame&&frame.contentWindow}catch(error){return false}
  var current=doc&&doc.getElementById(section.id);
  if(!current||!current.parentNode)return false;
  var index=v6VisibleSections().indexOf(section);
  if(index<0)return false;
  var holder=doc.createElement('div');
  try{holder.innerHTML=renderSection(section,index,state.project)}catch(error){return false}
  var next=holder.firstElementChild;
  if(!next)return false;
  var still=v6Still();
  next.style.opacity=still?'1':'0';
  current.replaceWith(next);
  // The swapped module has to behave immediately — its slider must scroll, its
  // tabs must switch — and it must not replay its entrance: `reveal` marks every
  // viewport effect as already seen rather than handing it to the observer.
  // This is what makes a full rebuild unnecessary, and a rebuild is precisely
  // what would jump the page to the top and re-animate the whole document.
  if(view&&typeof view.__sbsBind==='function'){
    try{view.__sbsBind(next,{reveal:true})}catch(error){/* a torn-down frame is not an error */}
  }else{
    next.classList.add('in-view');
    next.querySelectorAll('[data-viewport]').forEach(function(node){node.classList.add('in-view')});
  }
  if(!still){
    next.style.transition='opacity .26s cubic-bezier(.2,.6,.3,1)';
    requestAnimationFrame(function(){next.style.opacity='1'});
    setTimeout(function(){next.style.transition='';next.style.opacity=''},420);
  }
  return true;
}

/**
 * Re-renders the editor pane once per frame.
 *
 * The sequence list and the Selected pattern panel both name the pattern, so
 * they have to agree with the preview — but the pane is large and a run of
 * arrow presses would otherwise rebuild it once per press.
 */
var v6EditorFrame=0;
function v6QueueEditorSync(){
  if(v6EditorFrame)return;
  v6EditorFrame=requestAnimationFrame(function(){
    v6EditorFrame=0;
    renderEditor();
  });
}

/**
 * Repaints a global part inside the live preview document.
 *
 * The header carries behaviour that was bound when the document loaded — the
 * sticky class, the announcement dismiss, the burger — so the replacement is
 * handed to `__sbsBind`, which re-binds the chrome as well as the modules.
 */
function v6RepaintChrome(part){
  var frame=byId('sitePreview'),doc=null,view=null;
  try{doc=frame&&frame.contentDocument;view=frame&&frame.contentWindow}catch(error){return false}
  var current=doc&&doc.querySelector(part.selector);
  if(!current||!current.parentNode)return false;
  var holder=doc.createElement('div');
  try{holder.innerHTML=part.render()}catch(error){return false}
  var next=holder.firstElementChild;
  if(!next)return false;
  current.replaceWith(next);
  if(view&&typeof view.__sbsBind==='function'){
    try{view.__sbsBind(next,{reveal:true})}catch(error){/* a torn-down frame is not an error */}
  }
  return true;
}

/** Steps the header or the footer to the next or previous registered layout. */
function v6StepChrome(kind,delta){
  var part=v6ChromePart(kind);
  if(!part)return;
  var values=part.catalog.map(function(entry){return entry.value}),
    at=values.indexOf(part.value()),
    next=values[(((at<0?0:at)+delta)%values.length+values.length)%values.length];
  if(!next||next===part.value())return;
  inputCheckpoint();
  part.set(next);
  queueSave();
  if(!v6RepaintChrome(part))queuePreview();
  v6Paint(kind==='header'?V6_HEADER:V6_FOOTER);
  v6QueueEditorSync();
  announce(part.label+': '+v6VariantEntry(part).label);
}

/** Cycles the phone takeover style, from the navigation's own overlay. */
function v6StepMobileMenu(){
  var order=MOBILE_MENU_STYLES.map(function(entry){return entry.value}),
    at=order.indexOf(mobileMenuStyle(state.project.header.mobileMenu)),
    next=order[((at<0?0:at)+1)%order.length];
  inputCheckpoint();
  state.project.header.mobileMenu=next;
  queueSave();
  // The takeover is painted by the document stylesheet, not by the header
  // markup, so this one needs the rebuild rather than an in-place swap.
  queuePreview();
  v6Paint(V6_HEADER);
  v6QueueEditorSync();
  announce('Mobile menu: '+(MOBILE_MENU_STYLES.filter(function(entry){return entry.value===next})[0]||{}).label);
}

/** Hands the strategist to the editors for whichever part they were hovering. */
function v6OpenGlobals(kind){
  if(!kind)return;
  goStep(0);
  requestAnimationFrame(function(){
    var target=document.querySelector('[data-global-part="'+kind+'"]');
    if(!target)return;
    var collapsed=target.closest('details.panel-collapsible');
    if(collapsed)collapsed.open=true;
    target.scrollIntoView({behavior:'smooth',block:'start'});
  });
}

/** Steps a module to the next or previous registered pattern in its own family. */
function v6Step(sectionId,delta){
  var chrome=v6ChromeKind(sectionId);
  if(chrome){v6StepChrome(chrome,delta);return}
  var section=v6Section(sectionId);
  if(!section)return;
  var pool=v6PatternPool(section.family);
  if(pool.length<2){announce(( familyLabels[section.family]||section.family)+' has only one registered pattern.');return}
  var at=pool.findIndex(function(p){return p.id===section.patternId}),
    next=pool[(((at<0?0:at)+delta)%pool.length+pool.length)%pool.length];
  if(!next||next.id===section.patternId)return;
  // A run of presses is one gesture, so it is one undo — the same rule typing
  // already follows.
  inputCheckpoint();
  switchPattern(section,next);
  state.selectedSectionId=section.id;
  state.project.sections.forEach(syncSectionNode);
  queueSave();
  // Only when the module could not be patched in place — a torn-down frame,
  // mid-rebuild — does this fall back to rebuilding the whole document.
  if(!v6RepaintSection(section))queuePreview();
  // The overlay names the pattern, so it updates now; the editor panel names it
  // too but is a whole pane, so it is coalesced to one render per frame.
  v6Paint(sectionId);
  v6QueueEditorSync();
  announce(next.title);
}

/* ---------------------------------------------------------------- *
 * Wiring
 * ---------------------------------------------------------------- */

/**
 * Binds the hover tracking to the preview document.
 *
 * Re-bound on every rebuild, because a rebuilt `srcdoc` is a brand new document
 * and the old listeners went with the old one.
 */
function v6BindPreview(){
  var frame=byId('sitePreview'),doc=null,view=null;
  try{doc=frame&&frame.contentDocument;view=frame&&frame.contentWindow}catch(error){return}
  if(!doc||!view||doc===v6BoundDoc)return;
  v6BoundDoc=doc;
  // A module is addressed by an id the project owns; the two global parts are
  // addressed by their own sentinels. Anything else — a bare `<section>` the
  // renderer emitted — is not a target.
  function sectionAt(target){
    if(!target||!target.closest)return '';
    if(target.closest('.site-header'))return V6_HEADER;
    if(target.closest('.site-footer'))return V6_FOOTER;
    var node=target.closest('section[id]');
    return node&&v6Section(node.id)?node.id:'';
  }
  doc.addEventListener('mousemove',function(event){
    var id=sectionAt(event.target);
    if(!id){v6QueueHide();return}
    if(id===v6HoverId){v6Track();return}
    if(v6ChromeGuard(event.clientY)){v6Track();return}
    v6Show(id);
  },{passive:true});
  // `mouseleave` does not reach the document from an iframe body; a `mouseout`
  // with nothing to move on to is the reliable "pointer left the frame" signal.
  doc.addEventListener('mouseout',function(event){
    if(!event.relatedTarget)v6QueueHide();
  },{passive:true});
  doc.addEventListener('click',function(event){
    var id=sectionAt(event.target);
    // A click in the guard band is a click on the page, but it must not select a
    // module the overlay is not describing.
    if(id&&!v6ChromeGuard(event.clientY))v6Select(id);
  },true);
  view.addEventListener('scroll',v6Track,{passive:true});
}

var renderPreviewBeforeV6=renderPreview;
renderPreview=function(){
  var frame=byId('sitePreview');
  v6BoundDoc=null;
  renderPreviewBeforeV6();
  if(!frame)return;
  frame.addEventListener('load',function once(){
    frame.removeEventListener('load',once);
    v6BindPreview();
    // The rebuild reflows the page, so a module the pointer is still over has
    // almost certainly moved.
    if(v6HoverId)setTimeout(function(){if(v6HoverId)v6Paint(v6HoverId)},160);
  });
};

// The stage scrolls and the shell rescales without the preview document ever
// firing an event, so the overlay has to follow those too.
var v6Stage=document.querySelector('.preview-stage');
if(v6Stage)v6Stage.addEventListener('scroll',v6Track,{passive:true});
window.addEventListener('resize',v6Track);

// Arrow keys are the whole point of the interaction; wanting them to work
// without aiming at a 34px button is not a power-user request.
document.addEventListener('keydown',function(event){
  if(!v6HoverId||event.metaKey||event.ctrlKey||event.altKey)return;
  if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
  var focused=document.activeElement;
  if(focused&&/^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName))return;
  event.preventDefault();
  v6Step(v6HoverId,event.key==='ArrowRight'?1:-1);
});

/* ================================================================== *
 * v8 — Choosing the pattern the brief actually asked for
 *
 * Every family has a registered default, and until now every page took it. That
 * is why three concepts for three different businesses opened with the same
 * hero: the flow decided *which families* appeared, and nothing decided *which
 * pattern* of that family. The design dials moved colour and spacing on top of
 * an identical skeleton.
 *
 * So the pattern is now scored. The catalogue already describes each one — its
 * look, what it is best for, what to avoid it for, whether it carries media, how
 * many items it holds — and the brief plus the current design dials already say
 * what this page needs. Matching the two is arithmetic, and it is inspectable:
 * `__SBS_TEST_API.patternChoice()` returns the ranking with the reasons.
 *
 * Two properties matter as much as the ranking itself:
 *
 *   1. It is deterministic. The same brief and the same dials give the same
 *      page, every time. A layout that reshuffles on each press is not a
 *      recommendation, it is a slot machine.
 *   2. It varies with the *concept*, because the dials do. Pick the calm concept
 *      and the flow, and you get contained bands; pick the bold one and the same
 *      flow reaches for the photo-backed and full-bleed members of each family.
 * ================================================================== */

/** FNV-1a. Only needs to be stable and well-spread, not cryptographic. */
function v8Hash(value){
  var text=String(value),hash=2166136261;
  for(var i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return hash>>>0;
}

function v8Words(value){
  return String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

/** The brief as one bag of words, cached per brief so scoring stays cheap. */
var v8CorpusCache={key:'',value:''};
function v8BriefCorpus(){
  var brief=state.project.brief||{},
    key=[brief.industry,brief.audience,brief.goal,brief.offer,brief.tone,brief.keywords,brief.notes].join('|');
  if(v8CorpusCache.key!==key)v8CorpusCache={key:key,value:v8Words(key)};
  return v8CorpusCache.value;
}

/** Everything the catalogue says about a pattern, as one lowercase string. */
function v8Profile(pattern){
  if(!pattern.__sbsProfile){
    Object.defineProperty(pattern,'__sbsProfile',{
      value:v8Words([pattern.look,pattern.bestFor,pattern.category,pattern.title].join(' ')),
      enumerable:false
    });
  }
  return pattern.__sbsProfile;
}

function v8Has(profile,terms){
  for(var i=0;i<terms.length;i++)if(profile.indexOf(terms[i])>=0)return true;
  return false;
}

/** Overlap between the brief's own vocabulary and a pattern's description. */
function v8Overlap(corpus,profile){
  var seen={},score=0,words=corpus.split(' ');
  for(var i=0;i<words.length;i++){
    var word=words[i];
    if(word.length<5||seen[word])continue;
    seen[word]=true;
    if(profile.indexOf(word)>=0)score+=1;
  }
  return Math.min(6,score);
}

var V8_PHOTO_TERMS=['photo backed','photo gradient','image bg','background image','photo','imagery','full bleed'];
var V8_QUIET_TERMS=['contained band','plain band','text only','copy block','simple text'];
var V8_LOUD_TERMS=['gradient','bento','showcase','slider','image bg','full bleed','marquee'];

/**
 * How well one pattern fits this brief and this design, with the reasons.
 *
 * The dials do most of the work because they are the concept made numeric: a
 * concept that asked for dominant imagery should not be handed the family's
 * text-only member, however well the words happen to match.
 */
function v8Score(pattern,context){
  var profile=v8Profile(pattern),d=context.design,flags=pattern.flags||{},counts=pattern.counts||{},
    score=0,why=[];
  var add=function(amount,reason){if(!amount)return;score+=amount;why.push((amount>0?'+':'')+amount+' '+reason)};

  var imagery=Number(d.imagery),photo=v8Has(profile,V8_PHOTO_TERMS)||flags.media;
  if(photo)add(Math.round((imagery-50)/8),'carries photography');
  else add(Math.round((50-imagery)/12),'no photography to carry');

  var expressive=Number(d.expressiveness);
  if(v8Has(profile,V8_LOUD_TERMS))add(Math.round((expressive-50)/9),'expressive treatment');
  if(v8Has(profile,V8_QUIET_TERMS))add(Math.round((50-expressive)/11),'restrained treatment');

  // A dense page wants patterns that hold more; a spacious one wants fewer,
  // larger things. `items` is whatever this family repeats.
  var items=Math.max(counts.cards||0,counts.listItems||0,counts.accordionItems||0,counts.tabs||0,counts.columns||0);
  if(items)add(Math.round((Number(d.density)-50)/50*Math.min(4,items-2)),items+' repeated items');

  if(v8Has(profile,['full bleed','column split','edge']))add(Math.round((Number(d.measure)-50)/14),'wide composition');
  if(v8Has(profile,['centered','centred','contained']))add(Math.round((50-Number(d.measure))/16),'contained composition');
  if(flags.slider)add(Math.round((Number(d.motion)-50)/16),'moves on its own');

  add(v8Overlap(context.corpus,profile),'matches the brief’s own words');
  /*
   * The style's own pattern preferences.
   *
   * This is what makes a style change the *shape* of the page rather than only its
   * colours: Art Gallery reaches for spacious large-media bands and refuses dense
   * six-across grids, Precision SaaS does the opposite, and both are choosing from
   * the same 154 patterns.
   */
  if(context.style){
    var styleWeight=compilePatternWeight(context.style,pattern.family,profile);
    styleWeight.why.forEach(function(reason){
      var parts=reason.match(/^([+-])(\d+)\s+(.*)$/);
      if(parts)add(Number(parts[1]+parts[2]),parts[3]);
    });
  }
  // The catalogue's own recommendation is the incumbent, not just another
  // candidate: a brief that says nothing distinctive should keep the pattern the
  // library considers the family's best general answer, and only a real signal
  // in the brief or the dials should unseat it.
  if(pattern.id===DATA.defaultPatternByFamily[pattern.family])add(3,'the catalogue’s default for this family');
  // The catalogue's own warning is the strongest single signal it gives.
  if(pattern.avoidFor&&v8Overlap(context.corpus,v8Words(pattern.avoidFor))>=2)add(-5,'the catalogue warns against this brief');
  // Only a caller that says so gets the no-repeat penalty. Deriving it from the
  // page would be wrong at the one moment it matters: applying a flow replaces
  // every section, so the patterns "already on the page" are the ones about to
  // be thrown away — and penalising those is how a family ends up avoiding the
  // very pattern it should have kept.
  if(context.used[pattern.id])add(-7,'already used on this page');

  return {pattern:pattern,score:score,why:why};
}

/**
 * The family's patterns, best first.
 *
 * Ties break on a hash of the brief and the archetype rather than on catalogue
 * order, which is what stops a whole family collapsing onto its first entry when
 * the brief says nothing that distinguishes its members.
 */
function v8RankPatterns(family,options){
  var opts=options||{},pool=DATA.patterns.filter(function(p){return p.family===family});
  if(!pool.length)return [];
  v3EnsureDesign(state.project);
  var used={};
  (opts.used||[]).forEach(function(entry){
    var id=typeof entry==='string'?entry:entry&&entry.patternId;
    if(id)used[id]=true;
  });
  var context={
    design:state.project.design,
    corpus:v8BriefCorpus(),
    style:opts.style!==undefined?opts.style:v10ActiveStyle(),
    used:used
  };
  // The style joins the tie-break seed, so two concepts on two styles do not
  // collapse onto the same pattern whenever the brief says nothing decisive.
  var seed=v8Hash(context.corpus+'|'+(state.project.design.archetype||'')+'|'+(context.style?styleKey(context.style):'')+'|'+(opts.variant||'')+'|'+family+'|'+(opts.index||0));
  return pool.map(function(pattern){
    var entry=v8Score(pattern,context);
    entry.tiebreak=v8Hash(seed+'|'+pattern.id);
    return entry;
  }).sort(function(a,b){return b.score-a.score||a.tiebreak-b.tiebreak});
}

/** The one pattern this brief and this design should open a family with. */
function v8PickPattern(family,index,options){
  var ranked=v8RankPatterns(family,Object.assign({index:index},options||{}));
  return ranked.length?ranked[0].pattern:null;
}

/**
 * Re-selects every section's pattern for a style, keeping the words.
 *
 * A style that only recoloured the page would be a palette preset. This is where a
 * style changes the *shape* of the page: each band is re-ranked with that style's
 * own pattern preferences and swapped through `switchPattern`, which carries the
 * existing content across rather than resetting it to the demo copy.
 *
 * A section whose pattern the strategist chose by hand is left alone — an explicit
 * selection always wins (§39).
 */
function v10RepatternSections(concept,profile){
  if(!concept||!profile||!Array.isArray(concept.sections))return 0;
  var used=[],changed=0;
  concept.sections.forEach(function(section,index){
    if(section.patternLocked){used.push(section.patternId);return}
    var ranked=v8RankPatterns(section.family,{index:index,used:used,style:profile,variant:concept.variantType});
    var next=ranked.length?ranked[0].pattern:null;
    if(next&&next.id!==section.patternId){
      switchPattern(section,next);
      changed+=1;
    }
    used.push(section.patternId);
  });
  return changed;
}

/*
 * Only an unspecified pattern is chosen. An explicit id — a restored project, an
 * import, the pattern modal, the preview switcher — is always obeyed, so this
 * changes what the builder *proposes* and never what it was told.
 */
var createSectionBeforeV8=createSection;
createSection=function(family,index,patternId){
  var chosen=patternId||(v8PickPattern(family,index||0)||{}).id||null;
  var section=createSectionBeforeV8(family,index||0,chosen);
  // Composed in the active style's language from the moment it exists, rather than
  // in the demo project's and then restyled.
  var profile=v10ActiveStyle();
  if(profile&&section){
    var recipe=compileSectionRecipe(profile,family,{base:sectionPreset(family,index||0)});
    ensureSectionSettings(section);
    if(recipe.container)section.layout.container=recipe.container;
    if(recipe.paddingTop)section.layout.paddingTop=recipe.paddingTop;
    if(recipe.paddingBottom)section.layout.paddingBottom=recipe.paddingBottom;
    if(recipe.inverted!==undefined)section.layout.inverted=recipe.inverted;
    if(recipe.viewport!==undefined){section.effects=section.effects||{};section.effects.viewport=recipe.viewport}
    if(recipe.decoration)section.decoration=recipe.decoration;
    if(recipe.styleColumns){
      if(recipe.styleColumns.desktop)section.layout.columns=recipe.styleColumns.desktop;
      if(recipe.styleColumns.mobile)section.layout.columnsMobile=recipe.styleColumns.mobile;
    }
  }
  return section;
};

/*
 * A brief that states a colour, a typeface or a typographic scale has stated it
 * for the whole project, not for one concept. The archetype supplies the
 * starting point and the directives are layered over it, so choosing a different
 * archetype still restyles everything the brief did not pin down.
 */
var applyArchetypeBeforeV8=applyArchetype;
applyArchetype=function(key){
  applyArchetypeBeforeV8(key);
  // The concept is no longer resolving from a style profile, so it must stop
  // claiming to be. The review panel reads this to name the design source.
  var conceptForArchetype=getActiveConcept(state.project);
  if(conceptForArchetype&&conceptForArchetype.style&&conceptForArchetype.style.styleId){
    conceptForArchetype.style=Object.assign({},conceptForArchetype.style,{familyId:'',styleId:'',archetypeKey:key});
  }
  var directives=briefDirectives(state.project.brief);
  if(!directives.any)return;
  // `history:false` folds this into the archetype's own undo entry. A separate
  // entry would mean one press of Undo could leave the page on the new
  // archetype *without* the colours the brief asked for — a state the brief
  // never described and nobody chose.
  mutate(function(){
    var design=state.project.design;
    Object.keys(directives.palette).forEach(function(role){design.palette[role]=directives.palette[role]});
    if(directives.fontDisplay)design.fontDisplay=directives.fontDisplay;
    if(directives.fontBody)design.fontBody=directives.fontBody;
    Object.keys(directives.dials).forEach(function(dial){
      if(DIAL_KEYS.indexOf(dial)>=0)design[dial]=directives.dials[dial];
    });
    v3EnsureDesign(state.project);
  },{history:false,message:'Applied archetype '+key+', keeping what your brief asked for'});
};


/* ================================================================== *
 * v11 — Dropping a picture on the module it belongs to
 *
 * The imagery is in the editor and the page is in the preview, and until now the
 * only way across was to select a module, open its Media tab, find the slot in a
 * list and click the tile. That is three decisions to express one: *this* picture,
 * *there*.
 *
 * So every tile in the editor is draggable and every rendered picture in the
 * preview is a target. The slot is resolved from what the pointer is actually
 * over — a card takes that card's picture, a split takes that half's, a banner
 * takes its background — using the same slot list the stock-imagery job fills, so
 * a slot that can be dropped on is a slot the pattern really renders.
 * ================================================================== */

/* What is being dragged, held here rather than only on the DataTransfer: the
 * payload has to be readable during `dragover` to decide whether the module can
 * take it, and `getData` is deliberately empty until the drop. */
var v11Drag=null;

var V11_TILE_SELECTOR='.media-option[data-project-media],.media-option[data-media-index],[data-slot-library],[data-media-drag]';

/** Marks every picture tile in the editor as draggable. Called after each render. */
function v11MarkMediaTiles(){
  var host=byId('editorInner');
  if(!host)return 0;
  var tiles=host.querySelectorAll(V11_TILE_SELECTOR);
  Array.prototype.forEach.call(tiles,function(tile){
    tile.setAttribute('draggable','true');
    if(!tile.dataset.dragHinted){
      tile.dataset.dragHinted='1';
      var hint='Drag onto any module in the preview to place it there';
      tile.title=tile.title?tile.title+' · '+hint:hint;
    }
  });
  return tiles.length;
}

var renderEditorBeforeV11=renderEditor;
renderEditor=function(){
  renderEditorBeforeV11();
  v11MarkMediaTiles();
};

/** The media object one tile stands for, whichever kind of tile it is. */
function v11TileMedia(tile){
  if(!tile||!tile.dataset)return null;
  var assetId=tile.dataset.projectMedia||tile.dataset.mediaDrag;
  if(assetId){
    var asset=v5ProjectAssets().find(function(entry){return entry.id===assetId});
    return asset?{media:v5AssetMedia(asset),kind:asset.kind==='video'?'video':'image'}:null;
  }
  var index=tile.dataset.mediaIndex!==undefined?tile.dataset.mediaIndex:tile.dataset.slotLibrary;
  if(index===undefined)return null;
  var choice=DATA.media[Number(index)];
  return choice?{media:asMedia(choice),kind:isVideoMedia(choice)?'video':'image'}:null;
}

/*
 * The placeholder picker's own handler is in the builder's first layer, which is
 * outside this scope — so the repaint follows it as a second listener rather
 * than by reaching into it. Registered later, so it runs after the mutation it
 * is following and cancels the rebuild that mutation queued.
 */
byId('editorInner').addEventListener('click',function(event){
  if(!event.target.closest||!event.target.closest('[data-media-index]'))return;
  var section=state.project.sections.find(function(entry){return entry.id===state.selectedSectionId});
  if(section)v11PaintInPlace(section);
});

byId('editorInner').addEventListener('dragstart',function(event){
  var tile=event.target.closest?event.target.closest(V11_TILE_SELECTOR):null;
  var payload=tile?v11TileMedia(tile):null;
  if(!payload){v11Drag=null;return}
  v11Drag=payload;
  document.body.classList.add('is-media-dragging');
  if(event.dataTransfer){
    event.dataTransfer.effectAllowed='copy';
    // Something has to be set or Firefox refuses to start the drag; the source
    // URL is also the only sensible thing to paste anywhere else.
    try{event.dataTransfer.setData('text/plain',payload.media.src||'')}catch(error){}
  }
});

byId('editorInner').addEventListener('dragend',function(){
  v11Drag=null;
  document.body.classList.remove('is-media-dragging');
  v11ClearDropMarks();
});

/* ---------------------------------------------------------------- *
 * Which slot the pointer is over
 * ---------------------------------------------------------------- */

/**
 * The slot under the pointer, and the element to mark while it is there.
 *
 * Card order is the reliable part: a card's index among its siblings is the index
 * of the item it was rendered from, which is exactly where `v5FillSlots` writes.
 * Feature slots are matched by their order among the section's own pictures,
 * skipping the ones inside cards so the two never count each other.
 */
function v11SlotAt(section,root,target){
  var slots=v5SectionSlots(section);
  if(!slots.length||!root)return null;
  var cards=slots.filter(function(slot){return slot.role==='card'}),
    features=slots.filter(function(slot){return slot.role==='feature'}),
    background=slots.filter(function(slot){return slot.role==='background'})[0]||null,
    node=target&&target.closest?target:null;
  var card=node&&node.closest('.dst-card');
  if(card&&cards.length){
    // Counted among the section's own cards, not among its parent's children:
    // every renderer wraps a card in a single-child item element, so a sibling
    // index is always zero.
    var at=Array.prototype.slice.call(root.querySelectorAll('.dst-card')).indexOf(card);
    return {slot:cards[clamp(at<0?0:at,0,cards.length-1)],mark:card};
  }
  var figure=node&&node.closest('figure.ph');
  if(figure&&features.length){
    var loose=Array.prototype.filter.call(root.querySelectorAll('figure.ph'),function(item){return !item.closest('.dst-card')});
    var index=loose.indexOf(figure);
    return {slot:features[clamp(index<0?0:index,0,features.length-1)],mark:figure};
  }
  if(background)return {slot:background,mark:root};
  return {slot:features[0]||cards[0]||slots[0],mark:figure||root};
}

/*
 * How a target is marked, painted inline rather than from a stylesheet.
 *
 * These have to win against 154 patterns, several of which outline their own
 * cards, and against whatever the next pattern added does. An important inline
 * declaration is the one thing in the cascade that cannot be out-argued — and
 * because it is set on the node and removed again, none of it can reach an
 * export or survive the drag it belongs to.
 */
var V11_MARK_STYLE={
  'sbs-drop-zone':{outline:'2px dashed rgba(237,91,56,.9)','outline-offset':'-2px'},
  'sbs-drop-hit':{outline:'3px solid #ed5b38','outline-offset':'-3px','box-shadow':'0 0 0 3px rgba(255,255,255,.65)'},
  'sbs-drop-deny':{outline:'3px solid #b4472f','outline-offset':'-3px'}
};

/**
 * Repaints one section in the live preview instead of rebuilding the frame.
 *
 * A rebuilt `srcdoc` is a new document: it starts at the top, and the scroll
 * restore then walks it back down. That reads as the page jumping away and
 * animating back, and it takes the band the pointer is on with it — which is
 * exactly the wrong thing to do to somebody who has just dropped a picture on
 * that band and is looking at it.
 *
 * A picture landing in a slot changes one section, so `v6RepaintSection` can
 * swap that section in place. The rebuild `mutate` queued behind it is then not
 * only unnecessary but the whole problem, so it is cancelled.
 */
function v11PaintInPlace(section){
  if(!section||!v6RepaintSection(section))return false;
  clearTimeout(previewTimer);
  previewTimer=null;
  // The swapped element is a new one, so the overlay is measuring a node that
  // no longer exists.
  v6Track();
  return true;
}

var v11Marked=[];
function v11ClearDropMarks(){
  v11Marked.forEach(function(entry){
    entry.node.classList.remove(entry.className);
    Object.keys(V11_MARK_STYLE[entry.className]||{}).forEach(function(property){
      entry.node.style.removeProperty(property);
    });
  });
  v11Marked=[];
}
function v11Mark(node,className){
  if(!node)return;
  node.classList.add(className);
  var paint=V11_MARK_STYLE[className]||{};
  Object.keys(paint).forEach(function(property){
    node.style.setProperty(property,paint[property],'important');
  });
  v11Marked.push({node:node,className:className});
}

/**
 * Makes every module in the preview a drop target for the editor's pictures.
 *
 * The drag starts in the builder's document and ends in the frame's, which is
 * one drag as far as the browser is concerned because the frame is same-origin.
 * The payload is read from `v11Drag` rather than the DataTransfer so the module
 * can be judged during `dragover`, when a DataTransfer is intentionally blank.
 */
function v11BindMediaDrop(doc){
  if(!doc||!doc.body)return;

  function moduleAt(target){
    if(!target||!target.closest)return null;
    var node=target.closest('section[id]');
    var section=node?v6Section(node.id):null;
    return section?{section:section,root:node}:null;
  }

  doc.addEventListener('dragover',function(event){
    if(!v11Drag)return;
    var found=moduleAt(event.target);
    v11ClearDropMarks();
    if(!found){if(event.dataTransfer)event.dataTransfer.dropEffect='none';return}
    // A portrait has to be the client's own colleague. The refusal is shown on
    // the module rather than waiting for a drop that then does nothing.
    if(isPeopleFamily(found.section.family)){
      event.preventDefault();
      if(event.dataTransfer)event.dataTransfer.dropEffect='none';
      v11Mark(found.root,'sbs-drop-deny');
      return;
    }
    var hit=v11SlotAt(found.section,found.root,event.target);
    if(!hit){if(event.dataTransfer)event.dataTransfer.dropEffect='none';return}
    event.preventDefault();
    if(event.dataTransfer)event.dataTransfer.dropEffect='copy';
    v11Mark(found.root,'sbs-drop-zone');
    if(hit.mark!==found.root)v11Mark(hit.mark,'sbs-drop-hit');
  });

  doc.addEventListener('dragleave',function(event){
    if(!event.relatedTarget)v11ClearDropMarks();
  });

  doc.addEventListener('drop',function(event){
    if(!v11Drag)return;
    var found=moduleAt(event.target);
    v11ClearDropMarks();
    if(!found)return;
    event.preventDefault();
    var payload=v11Drag;
    v11Drag=null;
    document.body.classList.remove('is-media-dragging');
    if(isPeopleFamily(found.section.family)){
      announce('This module shows people, so it keeps the client’s own photographs.');
      return;
    }
    var hit=v11SlotAt(found.section,found.root,event.target);
    if(!hit||!hit.slot){announce('That module has no picture to replace.');return}
    v6Select(found.section.id);
    var where=hit.slot.role==='card'?'card '+(hit.slot.index+1)
      :hit.slot.role==='background'?'the background'
      :'visual '+(hit.slot.index+1);
    mutate(function(){
      v7SetSlotMedia(found.section,hit.slot,payload.media);
    },{message:(payload.kind==='video'?'Video':'Image')+' placed on '+where+' of '+(familyLabels[found.section.family]||found.section.family)});
    v11PaintInPlace(found.section);
  });
}

/* ---------------------------------------------------------------- *
 * The brief, out of a file
 *
 * The brief the client actually wrote is a PDF or a Word document, and until now
 * the only way in was to open it, select it and paste it. So the whole window is
 * a drop target for one: the text is extracted here, on this machine, and handed
 * to the same brain the textarea feeds.
 *
 * Where it lands depends on the builder. The simple builder wants the paragraph,
 * because that is its whole first step. The advanced builder wants the fields, so
 * the paragraph goes through the same splitter a simple-builder import uses, and
 * the document itself is kept verbatim as the internal note.
 * ---------------------------------------------------------------- */

function v11BriefDropZone(){
  return '<div class="brief-file-drop" data-brief-drop>'+
    '<label class="brief-file-drop__pick"><input type="file" multiple accept="'+escAttr(BRIEF_DOCUMENT_ACCEPT)+'" data-brief-file>'+
    '<b>Drop the brief document here</b>'+
    '<span>PDF, Word (.docx), RTF or a text file &middot; or click to choose. Read on this machine &mdash; the document is never uploaded.</span>'+
    '</label></div>';
}

var v3BrainContextBeforeV11=v3BrainContext;
v3BrainContext=function(){
  var context=v3BrainContextBeforeV11();
  // One copy of the markup, used by the simple builder's brief panel and the
  // advanced builder's own panel below.
  context.briefDropZone=v11BriefDropZone;
  context.briefDocumentAccept=BRIEF_DOCUMENT_ACCEPT;
  return context;
};

var renderBriefBeforeV11=renderBrief;
renderBrief=function(){
  var output=renderBriefBeforeV11();
  var panelHtml=panel('Start from the client’s own brief',
    '<div class="panel-note">A PDF, a Word document or a text file. The words are read here in the browser, split into the fields below, and kept in full as the internal note so nothing the client wrote is lost.</div>'+
    v11BriefDropZone(),
    'PDF &middot; .docx &middot; .rtf &middot; text');
  // At the top of the step: it is the thing to do before filling anything in by
  // hand, not a footnote after having done so.
  var anchor=output.indexOf('<section class="panel"');
  return anchor<0?output+panelHtml:output.slice(0,anchor)+panelHtml+output.slice(anchor);
};

/** True when what is being dragged over the window is files from the desktop. */
function v11IsFileDrag(event){
  var transfer=event.dataTransfer;
  if(!transfer)return false;
  var types=transfer.types?Array.prototype.slice.call(transfer.types):[];
  return types.indexOf('Files')>=0;
}

var v11BriefDrop=null,v11DragDepth=0;
function v11BuildBriefDrop(){
  if(v11BriefDrop)return v11BriefDrop;
  var root=document.createElement('div');
  root.className='brief-drop';
  root.id='briefDrop';
  root.hidden=true;
  root.innerHTML='<div class="brief-drop__card"><b>Drop the brief here</b>'+
    '<span>PDF, Word (.docx), RTF or a text file. It is read on this machine — nothing is uploaded.</span></div>';
  document.body.appendChild(root);
  v11BriefDrop=root;
  return root;
}
function v11ShowBriefDrop(open){
  var root=v11BuildBriefDrop();
  root.hidden=!open;
  document.body.classList.toggle('is-file-dragging',!!open);
}

window.addEventListener('dragenter',function(event){
  if(!v11IsFileDrag(event))return;
  event.preventDefault();
  v11DragDepth+=1;
  v11ShowBriefDrop(true);
});
window.addEventListener('dragover',function(event){
  if(!v11IsFileDrag(event))return;
  event.preventDefault();
  if(event.dataTransfer)event.dataTransfer.dropEffect='copy';
  v11ShowBriefDrop(true);
});
window.addEventListener('dragleave',function(event){
  if(!v11IsFileDrag(event))return;
  v11DragDepth=Math.max(0,v11DragDepth-1);
  if(!v11DragDepth)v11ShowBriefDrop(false);
});
window.addEventListener('drop',function(event){
  if(!v11IsFileDrag(event))return;
  v11DragDepth=0;
  v11ShowBriefDrop(false);
  // The concept-JSON control in Step 01 handles its own drop and marks the event
  // as handled; a second reading of the same file would import it twice.
  if(event.defaultPrevented)return;
  event.preventDefault();
  v11ReadBriefFiles(event.dataTransfer&&event.dataTransfer.files);
});

byId('editorInner').addEventListener('change',function(event){
  var input=event.target.closest?event.target.closest('[data-brief-file]'):null;
  if(!input||!input.files||!input.files.length)return;
  // Copied before the input is cleared: emptying the value empties the FileList
  // with it, and the read is asynchronous.
  var files=Array.prototype.slice.call(input.files);
  input.value='';
  v11ReadBriefFiles(files);
});

/** A concept export dropped on the window is still an import, not a brief. */
async function v11IsConceptJson(file){
  if(!file||!/\.json$/i.test(file.name||''))return false;
  try{
    var payload=safeJson(await file.text());
    return !!(payload&&payload.concept&&payload.concept.page);
  }catch(error){return false}
}

function v11SkippedMessage(skipped){
  var first=skipped[0];
  return skipped.length===1
    ? first.name+' could not be read: '+first.reason+'.'
    : skipped.length+' files could not be read. The first: '+first.name+' — '+first.reason+'.';
}

async function v11ReadBriefFiles(files){
  var list=Array.prototype.slice.call(files||[]);
  if(!list.length)return;
  if(list.length===1&&await v11IsConceptJson(list[0])){v4ImportConcept(list[0]);return}
  announce(list.length===1?'Reading '+list[0].name+'…':'Reading '+list.length+' documents…');
  var simple=v4IsSimple();
  var existing=simple?String(v4EnsureSimple(state.project).briefText||''):'';
  var result;
  try{
    result=await readBriefDocuments(list,{existing:existing});
  }catch(error){
    announce('Those files could not be read.');
    return;
  }
  if(!result.read.length){announce(v11SkippedMessage(result.skipped.length?result.skipped:[{name:'That file',reason:'it held no text'}]));return}
  var names=result.read.map(function(entry){return entry.name}).join(', ');
  var tail=(result.skipped.length?' '+v11SkippedMessage(result.skipped):'')+
    (result.truncated?' It was longer than '+BRIEF_TEXT_LIMIT.toLocaleString()+' characters, so the end was trimmed.':'');

  if(simple){
    v4EnsureSimple(state.project).briefText=result.text;
    queueSave();
    goStep(0);
    announce(names+' read into the brief — '+result.characters.toLocaleString()+' characters. Read it to build the three concepts.'+tail);
    return;
  }

  // The advanced builder is unusable without the individual fields, so the
  // paragraph goes through the same splitter the concept import uses.
  var expanded=typeof briefBrainFeature.expandBriefForImport==='function'
    ? await briefBrainFeature.expandBriefForImport(result.text)
    : null;
  var split=!!(expanded&&!expanded.error);
  mutate(function(){
    if(split)v4ApplyBriefFields(expanded,{briefText:result.text,replaceNotes:true});
    else state.project.brief.notes=result.text;
  },{message:''});
  goStep(0);
  announce(split
    ? names+' read and split into the brief fields — check them before continuing.'+tail
    : names+' read into the internal notes. The field split needs the brief server, so fill the fields in yourself.'+tail);
}

var v6BindPreviewBeforeV11=v6BindPreview;
v6BindPreview=function(){
  var frame=byId('sitePreview'),doc=null;
  try{doc=frame&&frame.contentDocument}catch(error){return}
  // The original binds once per document and records which one; only a document
  // it has just adopted needs the drop listeners too.
  var fresh=!!doc&&doc!==v6BoundDoc;
  v6BindPreviewBeforeV11();
  if(fresh&&doc===v6BoundDoc)v11BindMediaDrop(doc);
};

/* ================================================================== *
 * v19 — Named corrections: a held picture, a readable form, a real wordmark
 *
 * Five small things, each reported from looking at a real page.
 * ================================================================== */

/*
 * A column can hold still while the column beside it scrolls.
 *
 * The two `p31` stats bands put a tall picture beside a list of figures, and
 * centring the picture against a list twice its height leaves it floating in the
 * middle of a lot of nothing. Held at the top of the band while the figures move
 * past it, the same two columns read as one composition.
 *
 * `class` is a registered DST attribute, so the marker the pattern carries is a
 * real class in WordPress too rather than something only the preview knows.
 */
var renderNodeBeforeV19=renderNode;
renderNode=function(node,ctx){
  if(!node||node.component!=='ds-blocks/ds-column')return renderNodeBeforeV19(node,ctx);
  var attrs=node.attributes||{},extra=cleanText(attrs.class||attrs.className||'');
  var html=renderNodeBeforeV19(node,ctx);
  if(!extra)return html;
  return html.replace('class="ds-column"','class="ds-column '+escAttr(extra)+'"');
};

/**
 * A colour dark enough to read on the form slot's white card.
 *
 * `p.ink` is the page's text colour, and on a dark-ground palette that is a pale
 * colour — pale type on the white card the form sits on. So the darkest of the
 * palette's own candidates is used, and `#111` is the floor when a palette has
 * nothing dark in it at all.
 */
function v19FormInk(palette){
  var candidates=[palette.ink,palette.dark,'#111111'];
  for(var i=0;i<candidates.length;i++){
    var hex=String(candidates[i]||'');
    if(/^#[0-9a-f]{3,8}$/i.test(hex)&&relativeLum(hex)<.38)return hex;
  }
  return '#111111';
}

var siteCssBeforeV19=siteCss;
siteCss=function(project){
  var palette=project.design.palette;
  return siteCssBeforeV19(project)+'\n'+[
    /*
     * The closing statement is the last thing a visitor reads, and it was
     * measured at 105rem with its headline clamped to twelve characters — which
     * broke a four-word sign-off across four lines. It takes the width it has.
     */
    '#sbs-site .sbs-footer-statement{max-width:100%}',
    '#sbs-site .sbs-footer-statement .footer__nl-head{max-width:100%}',
    /*
     * The centred layout is the exception, and it has to be.
     *
     * Centring is relative to something: with the statement at full width there
     * is nothing to centre within, and the centred footer became a copy of the
     * editorial one. It keeps a reading measure — which is what a centred line
     * needs anyway, because a single centred sentence 1,400px wide is not a
     * composition either.
     */
    '#sbs-site .sbs-footer.footer-centered .sbs-footer-statement{max-width:105rem}',
    '#sbs-site .sbs-footer.footer-centered .sbs-footer-statement .footer__nl-head{max-width:20ch}',
    // Pale type on the white card the form sits on, whenever the palette's ink
    // is light. The form is the one surface that is always white.
    '#sbs-site .sbs-form-slot{color:'+v19FormInk(palette)+'}',
    '#sbs-site .sbs-form-slot__head b{color:'+v19FormInk(palette)+'}',
    /*
     * The held column.
     *
     * `align-self:start` is what makes sticky mean anything in a grid: a stretched
     * item is already as tall as the row and has nowhere to travel. The ancestors
     * are un-clipped explicitly — `overflow:hidden` anywhere above a sticky
     * element silently turns it back into a static one, and `.has-bg-media` and
     * the decoration layers both set it.
     */
    /*
     * One sticky offset for the whole page.
     *
     * `top:0` pinned a held column under the sticky header, which covered the top
     * of the picture. `--sbs-sticky-top` is the single value every sticky element
     * uses — the held media column, the timeline counter, the stacking cards — so
     * they line up with each other instead of each choosing its own.
     */
    '#sbs-site{--sbs-sticky-top:12rem}',
    '#sbs-site .ds-column.is-sticky-media{position:sticky;top:var(--sbs-sticky-top,12rem);align-self:start}',
    '#sbs-site .ds-row:has(.is-sticky-media){position:relative;align-items:start}',
    '#sbs-site .dst-wrapper:has(.is-sticky-media),#sbs-site .ds-columns:has(.is-sticky-media){overflow:visible}',
    '#sbs-site .ds-column.is-sticky-media .dst-media,#sbs-site .ds-column.is-sticky-media .ph{max-height:100%}',
    // A held picture that is taller than the viewport can never be seen whole,
    // so it is bounded by the window rather than by the row beside it.
    '@media(min-width:901px){#sbs-site .ds-column.is-sticky-media>*{max-height:calc(100vh - var(--sbs-sticky-top,12rem) - 2rem)}}',
    // Sticky and a phone's single column do not mix: the picture would pin to
    // the top and the copy would scroll under it.
    '@media(max-width:900px){#sbs-site .ds-column.is-sticky-media{position:static}}',
    /*
     * The held heading column.
     *
     * Its row is the containing block, so the row is the one that has to be
     * positioned — a sticky element resolves its offsets against the nearest
     * positioned ancestor, and without that it pins to the viewport and slides
     * out of its own band.
     */
    '#sbs-site .ds-row:has(.is-sticky-heading){position:relative;align-items:start}',
    '#sbs-site .ds-column.is-sticky-heading{position:sticky;top:var(--sbs-sticky-top,12rem);align-self:start}',
    '#sbs-site .dst-wrapper:has(.is-sticky-heading),#sbs-site .ds-columns:has(.is-sticky-heading){overflow:visible}',
    // Sticky and one column do not mix: the heading would pin and the entries
    // would scroll underneath it.
    '@media(max-width:900px){#sbs-site .ds-column.is-sticky-heading{position:static}}'
  ].join('');
};

/*
 * The watermark is the client's name.
 *
 * `footer.wordmark` was seeded once from the brand and then never revisited —
 * `if(!project.footer.wordmark)` is only ever true on a brand new project — so
 * every page built afterwards carried "Vision" across the bottom, from the
 * default project's own name. It now follows the brand the way the logo text and
 * the legal line already do, until somebody types their own.
 */
var v2SyncBrandBeforeV19=v2SyncBrand;
v2SyncBrand=function(project,force){
  v2SyncBrandBeforeV19(project,force);
  if(!project||!project.footer)return;
  var brand=cleanText(project.brief.clientName||project.brief.projectName||project.client||'');
  if(!brand)return;
  if(force||!project.footer.wordmarkCustom)project.footer.wordmark=v19Wordmark(brand);
};

/**
 * The brand as a watermark.
 *
 * One word, because it is set at ten rem and two words at that size is a wall.
 * The first word is right for "Red Moon Motorcycles" and wrong for "The Bicycle
 * Company", so a leading article is dropped first — and a first word short
 * enough to read as a fragment takes the second with it.
 */
var V19_ARTICLES=['the','a','an'];
function v19Wordmark(brand){
  var words=String(brand).split(/\s+/).filter(Boolean);
  if(V19_ARTICLES.indexOf(String(words[0]||'').toLowerCase())>=0&&words.length>1)words=words.slice(1);
  if(!words.length)return brand;
  if(words[0].length<=3&&words[1])return words[0]+' '+words[1];
  return words[0];
}

/*
 * Typing a wordmark keeps it.
 *
 * The same rule the logo text and the legal line follow: the field is the
 * strategist's from the moment they touch it, and the brand sync stops writing
 * over it.
 */
var updateBindingBeforeV19=updateBinding;
updateBinding=function(path,value,input){
  if(String(path||'')==='global.footer.wordmark')state.project.footer.wordmarkCustom=true;
  return updateBindingBeforeV19(path,value,input);
};

/* ================================================================== *
 * v22 — A pale band paints in the palette's dark, and its buttons work
 *
 * v18 made the *band class* follow the overlay, so a hero fading white across
 * the frame stopped claiming to be an inverted band. That was half the job. The
 * other half is what `is-style-colors-standard` actually resolves to:
 *
 *   --dst--base-text-color   #EAEAEA   on a dark-ground concept palette
 *
 * `ink` is the page's text colour, and on a dark-ground palette it is a *pale*
 * colour — correct against a near-black page and wrong against a white wash. So
 * the headline, the pretitle, the supporting line and the outlined buttons all
 * rendered #EAEAEA on white. Which is what the screenshots showed.
 *
 * On a pale band the copy uses the palette's **dark** role, explicitly. It is the
 * one colour in the palette guaranteed to read on a light ground, and it is the
 * colour a designer would reach for.
 *
 * Buttons had a second, separate problem: their variant was chosen from
 * `section.layout.inverted` — the family preset — rather than from the tone the
 * band actually resolved to. Two of these heroes therefore rendered
 * `-primary-inverted` and `-secondary-inverted` on a white wash: a white outline
 * and a white label on white. The renderer now reads the resolved surface.
 * ================================================================== */

/**
 * The button variant follows the ground it sits on.
 *
 * `ctx.surfaceInverted` is what the banner and wrapper renderers already compute
 * from the overlay; `layout.inverted` is only the family's opening guess. Reading
 * the preset produced an invisible button on every pale hero.
 */
var v2RenderButtonBeforeV22=v2RenderButton;
v2RenderButton=function(node,ctx){
  var resolved=ctx&&ctx.surfaceInverted;
  if(resolved===undefined||!ctx||!ctx.section)return v2RenderButtonBeforeV22(node,ctx);
  var layout=ctx.section.layout||{},was=layout.inverted;
  layout.inverted=!!resolved;
  try{return v2RenderButtonBeforeV22(node,ctx)}
  finally{layout.inverted=was}
};

var siteCssBeforeV22=siteCss;
siteCss=function(project){
  var palette=project.design.palette,dark=palette.dark,bg=palette.bg,accent=palette.accent;
  /*
   * `readableOn` picks the label colour for a filled dark button from the
   * palette's own candidates rather than assuming white — a mid-dark brand
   * colour needs the page ground, not #fff.
   */
  var onDark=readableOn(dark,['#ffffff',bg,palette.soft]);
  var onAccent=readableOn(accent,['#ffffff',dark,palette.ink]);
  // Only the bands the tone pass judged *pale* — a light wash over a photograph.
  // `is-pale-overlay` is set by `sectionClasses` for exactly that case, which is
  // narrower than the standard tone and has to be: on an ordinary light band the
  // palette's dark role is the background.
  var band='#sbs-site .is-pale-overlay';
  return siteCssBeforeV22(project)+'\n'+[
    /* The copy. `!important` because the tone layer already uses it, and the two
       rules would otherwise be decided by source order. */
    /*
     * The band re-points the roles rather than overruling the families.
     *
     * Forcing `.c-btn.-primary{color:…!important}` assumed every family fills
     * the primary with the accent. Three of the ten do not: Magnetic Arrow and
     * Neon Trace leave it unfilled and take their label from the text role, so
     * the forced light label landed on the pale wash itself. Feeding the roles
     * the band actually has lets each family compute what it was written to
     * compute — including its hover, which no `!important` here could reach.
     *
     * `primary-color3` is the ink role, which the families flood with as though
     * it were dark; inside a pale band the dark role is what that means, and
     * `--sbs-on-ink` has to follow it. `body-bg` is the plate Depth Press paints
     * its secondary on, and on a dark palette that is a dark plate on a pale
     * band — here the ground is the wash, so it is white.
     */
    band+'{--sbs-band-ink:'+dark+';'
      +'--dst--base-text-color:'+dark+';--dst--base-heading-color:'+dark+';--dst--subtitle-color:'+dark+';'
      +'--dst--primary-color3:'+dark+';--sbs-on-ink:'+onDark+';--dst--body-bg:#ffffff;'
      +'--dst--btn-secondary-c:'+dark+';--dst--btn-secondary-bdc:'+dark+';'
      +'--dst--btn-secondary-c-hover:'+onDark+';--dst--btn-secondary-bg-hover:'+dark+';'
      +'--dst--btn-primary-c:'+onAccent+';--dst--btn-primary-bg:'+accent+';--dst--btn-primary-bdc:'+accent+';'
      +'--dst--btn-primary-c-hover:'+onDark+';--dst--btn-primary-bg-hover:'+dark+';'
      +'--dst--btn-link-c:'+dark+'}',
    [band+' .c-heading__title',band+' .c-heading__pre',band+' .c-heading__sub',
     band+' .c-heading__description',band+' .c-heading__description .sbs-rich-text',
     band+' .sbs-rich-text p',band+' .dst-list__title',band+' .dst-list__description',
     band+' .c-heading__backtitle'].join(',')+'{color:'+dark+'!important}',
    /* The text button has no fill to reason about, so it is stated outright. */
    band+' .c-btn.-link{color:'+dark+'!important}',
    band+' .c-btn.-link:hover,'+band+' .c-btn.-link:focus-visible{color:'+accent+'!important}',
    band+' .scroll-down{color:'+dark+'!important;opacity:.9}',
    /* The eyebrow rule and the arrow glyph are drawn in currentColor, so they
       follow — except the rule, which is painted from the accent on purpose. */
    band+' .c-heading__pre::before{background:'+accent+'!important}',
    /* Focus has to be visible on a pale ground too: the default ring is the
       accent, which can be low-contrast against a white wash. */
    band+' .c-btn:focus-visible{outline:2px solid '+dark+';outline-offset:3px}'
  ].join('');
};

/* ================================================================== *
 * v21 — Only attributes the theme declares leave the builder
 *
 * `scripts/verify-against-theme.mjs` looks every exported attribute up in the
 * theme's own `block.json` and reports the ones that are not there. WordPress
 * keeps an unknown attribute in the block comment and ignores it — so it is not
 * an error, it is worse: a setting the strategist made that the page does not
 * have, and nothing anywhere says so.
 *
 * Two of them were real:
 *
 *   backgroundOverlayOpacity   The theme carries an overlay's strength *inside
 *                              the colour* — `#333333b0`, `rgba(7,28,42,.82)` —
 *                              and declares no opacity attribute. Exported as a
 *                              separate number, every scrim landed at full
 *                              strength: a hero's photograph vanished behind a
 *                              solid band of ink. So the strength is folded into
 *                              the colour, which is both what the theme reads and
 *                              what the preview already computes.
 *
 *   htmlTag                    Invented by `makeFullBleedBand`. A wrapper is a
 *                              `<section>` and has no say in it.
 * ================================================================== */

/** `0` … `1`, whatever the attribute happens to hold. */
function v21Strength(value){
  var number=Number(value);
  if(!Number.isFinite(number))return 1;
  if(number>1)number=number/100;
  return Math.max(0,Math.min(1,number));
}

function v21HexAlpha(alpha){
  var byte=Math.round(clamp(alpha,0,1)*255).toString(16);
  return byte.length<2?'0'+byte:byte;
}

/**
 * One colour, at a fraction of its own opacity.
 *
 * Multiplied rather than replaced: a stop that was already half transparent and
 * sits under a 60% scrim ends up at 30%, which is what the browser composites in
 * the preview. Replacing would make a fading gradient opaque at both ends.
 */
function v21Fade(colour,strength){
  var text=String(colour||'').trim();
  if(!text||strength>=1)return text;
  var rgba=text.match(/^rgba?\(\s*([^)]+)\)$/i);
  if(rgba){
    var parts=rgba[1].split(/[,\/]/).map(function(part){return part.trim()});
    var alpha=parts.length>3?Number(parts[3]):1;
    if(!Number.isFinite(alpha))alpha=1;
    return 'rgba('+parts.slice(0,3).join(', ')+', '+Number((alpha*strength).toFixed(3))+')';
  }
  var hex8=text.match(/^#([0-9a-f]{6})([0-9a-f]{2})$/i);
  if(hex8)return '#'+hex8[1]+v21HexAlpha(parseInt(hex8[2],16)/255*strength);
  var hex6=text.match(/^#([0-9a-f]{6})$/i);
  if(hex6)return '#'+hex6[1]+v21HexAlpha(strength);
  var hex3=text.match(/^#([0-9a-f]{3})$/i);
  if(hex3){
    var full=hex3[1].split('').map(function(c){return c+c}).join('');
    return '#'+full+v21HexAlpha(strength);
  }
  if(/^transparent$/i.test(text))return text;
  /*
   * A token or a keyword cannot be faded here, because its value is only known
   * in the browser. `color-mix` is how CSS says "this colour, weaker", and every
   * browser the theme supports has it.
   */
  return 'color-mix(in srgb, '+text+' '+Math.round(strength*100)+'%, transparent)';
}

/** A gradient at a fraction of its opacity: every stop, individually. */
function v21FadeValue(value,strength){
  var text=String(value||'').trim();
  if(!text||strength>=1)return text;
  if(!/gradient\(/i.test(text))return v21Fade(text,strength);
  return text.replace(/rgba?\([^)]*\)|#[0-9a-f]{8}\b|#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi,function(stop){
    return v21Fade(stop,strength);
  });
}

var V21_OVERLAY_PAIRS=[
  ['backgroundOverlay','backgroundOverlayOpacity'],
  ['mediaOverlay','mediaOverlayOpacity']
];

/**
 * Folds every overlay strength into its colour, everywhere in one tree.
 *
 * Done at the very end rather than inside `normalizeExportNode`, because the
 * fidelity layer writes the surface attributes *after* the node normalizer has
 * run — folding earlier left every strength to be written straight back.
 */
function v21Clean(node){
  if(!node||typeof node!=='object')return node;
  var attrs=node.attributes||{};
  V21_OVERLAY_PAIRS.forEach(function(pair){
    var colour=pair[0],opacity=pair[1];
    if(!(opacity in attrs))return;
    var strength=v21Strength(attrs[opacity]);
    delete attrs[opacity];
    if(!attrs[colour])return;
    if(attrs.backgroundOverlayEnabled===false)return;
    attrs[colour]=v21FadeValue(attrs[colour],strength);
  });
  // A background layer carries its own overlay the same way.
  var layers=attrs.backgroundImage;
  if(Array.isArray(layers))layers.forEach(function(layer){
    if(!layer||typeof layer!=='object')return;
    if(!('overlayOpacity' in layer))return;
    var strength=v21Strength(layer.overlayOpacity);
    delete layer.overlayOpacity;
    if(layer.overlay&&layer.overlayEnabled!==false)layer.overlay=v21FadeValue(layer.overlay,strength);
  });
  // A wrapper is a `<section>`; the block has no say in its tag.
  if(node.component==='ds-blocks/dst-wrapper')delete attrs.htmlTag;
  (node.children||[]).forEach(v21Clean);
  return node;
}

var normalizeExportSectionBeforeV21=normalizeExportSection;
normalizeExportSection=function(section){
  return v21Clean(normalizeExportSectionBeforeV21(section));
};

var headerExportBeforeV21=headerExport;
headerExport=function(project){return v21Clean(headerExportBeforeV21(project))};

var footerExportBeforeV21=footerExport;
footerExport=function(project){return v21Clean(footerExportBeforeV21(project))};

/* ================================================================== *
 * v23 — What the preview refuses to draw does not get exported
 *
 * Every one of the 153 `c-btn` nodes in the catalogue exported with an empty
 * `text`, across 77 patterns. The preview does not draw those — `v2RenderButton`
 * returns nothing for a button with no label — so nobody saw them until they
 * arrived in WordPress as `<a class="c-btn -primary"><span class="c-btn__txt">`
 * with nothing inside: a real, clickable, invisible control on the page.
 *
 * A button with no label is not a setting the strategist made. It is a slot the
 * content pass never filled, and the export is the last place to catch it.
 * ================================================================== */

/** The label a button would render with, from either place the export keeps it. */
function v23ButtonLabel(node){
  var attrs=node&&node.attributes||{};
  return cleanText(attrs.text||node&&node.text||'');
}

/*
 * Builder-internal attributes, removed at the boundary.
 *
 * `groupTheme` decides which button variant the *preview* draws. WordPress has no
 * such control — the theme picks the variant from the band's own tone class — so
 * exporting it produced the one honest "not registered" warning left in the
 * importer's catalogue sweep.
 */
var V23_INTERNAL_ATTRIBUTES={'ds-blocks/c-btn':['groupTheme']};

/**
 * Drops what WordPress would render as an empty control.
 *
 * Returns the node, or null when it should not exist. A button group emptied by
 * this goes too: it lays out a flex row of nothing and takes a gap with it.
 */
/*
 * How many cards a slider shows, in the words the theme reads.
 *
 * `dst-slider.js` takes `visibleItemsDesktop`, `visibleItemsTablet` and
 * `visibleItemsMobile` out of `dstSliderSettings`. The export sent only
 * `bleedRightVisibleItems`, so the theme fell back to its own default and an
 * imported slider showed three cards side by side on a phone — the preview shows
 * one. Derived from the column counts the band already carries, so the two
 * cannot drift apart.
 */
function v23SliderVisibility(node){
  if(!node||node.component!=='ds-blocks/c-cards')return;
  var attrs=node.attributes||{};
  if(!attrs.enableDstSlider)return;
  var settings=attrs.dstSliderSettings&&typeof attrs.dstSliderSettings==='object'?attrs.dstSliderSettings:{};
  var desktop=Math.max(1,Number(attrs.columnsDesktop||attrs.columns||3));
  var tablet=Math.max(1,Number(attrs.columnsTablet||Math.min(2,desktop)));
  var mobile=Math.max(1,Number(attrs.columnsMobile||1));
  var across=Number(settings.bleedRightVisibleItems);
  if(settings.visibleItemsDesktop==null)settings.visibleItemsDesktop=Math.min(desktop,Number.isFinite(across)&&across>0?across:desktop);
  if(settings.visibleItemsTablet==null)settings.visibleItemsTablet=tablet;
  if(settings.visibleItemsMobile==null)settings.visibleItemsMobile=mobile;
  attrs.dstSliderSettings=settings;
}

function v23Prune(node){
  if(!node||typeof node!=='object')return node;
  v23SliderVisibility(node);
  var internal=V23_INTERNAL_ATTRIBUTES[node.component];
  if(internal&&node.attributes){
    internal.forEach(function(name){delete node.attributes[name]});
  }
  if(node.component==='ds-blocks/c-btn'&&!v23ButtonLabel(node))return null;
  if(Array.isArray(node.children)){
    node.children=node.children.map(v23Prune).filter(function(child){return child!==null});
    if(node.component==='ds-blocks/button-group'&&!node.children.length)return null;
  }
  return node;
}

var normalizeExportSectionBeforeV23=normalizeExportSection;
normalizeExportSection=function(section){
  return v23Prune(normalizeExportSectionBeforeV23(section));
};

var headerExportBeforeV23=headerExport;
headerExport=function(project){return v23Prune(headerExportBeforeV23(project))};

var footerExportBeforeV23=footerExport;
footerExport=function(project){return v23Prune(footerExportBeforeV23(project))};

/* ================================================================== *
 * v20 — The header and the footer are real block trees
 *
 * They were shorthand. `headerExport` emitted one `dst-navigation` node with a
 * `nav: {logo, menu, cta}` object hanging off it and `importerShorthand: true`,
 * and the plugin expanded that into whatever it guessed the navigation family
 * looked like. The footer did the same. Which is why an imported header never
 * matched the preview: nobody was reading the theme.
 *
 * The theme ships the answer. `parts/header.html` and `parts/footer.html` in the
 * digitalsilk theme are the canonical trees — the exact blocks, the exact
 * attribute names, the exact nesting — and these two functions build them:
 *
 *   dst-navigation
 *     dst-navigation-announcement > simple-text > paragraph
 *     dst-navigation-top
 *     dst-navigation-main
 *       dst-navigation-content[logo]   > dst-site-logo
 *       dst-navigation-content[menu]   > dst-navigation-menu
 *       dst-navigation-content[search] > dst-navigation-search
 *     dst-navigation-mobile
 *       dst-navigation-content[logo] > dst-site-logo
 *       dst-navigation-mobile-dropdown > dst-navigation-menu
 *     dst-navigation-bottom
 *
 *   dst-footer
 *     dst-footer-section[top]    > dst-footer-slot > dst-block-title
 *     dst-footer-section[middle] > 4 × dst-footer-slot
 *     dst-footer-section[bottom] > 3 × dst-footer-slot
 *
 * Menus are the other half. The theme's menu blocks read a *location*
 * (`menuSource: 'location'`, `menuLocation: 'primary-menu'`) rather than a list
 * of links, so the links go in the artifact for the importer to build the menu
 * from and the blocks name the location they expect to find it in. Anything else
 * imports as an empty menu.
 * ================================================================== */

var V20_ID=0;
function v20Node(component, attributes, children){
  V20_ID+=1;
  return {
    id:'global-'+component.split('/').pop()+'-'+V20_ID,
    component:component,
    usage:'global',
    confidence:'confirmed',
    attributes:attributes||{},
    children:children||[],
    layout:{container:'full'}
  };
}

/**
 * A list of links, as one paragraph of anchors.
 *
 * The theme's footer part does exactly this for its own link column. `c-list-item`
 * looks like the right block and is not: it has `listTitle`, `listSubTitle`,
 * `heroText` and `icon`, and no link attribute at all — so a link column built
 * from list items imports as a column of unclickable words.
 */
function v20Links(links,separator){
  var list=(links||[]).filter(function(link){return link&&cleanText(link[0])});
  var html=list.map(function(link){
    return '<a href="'+escAttr(normalizeLink(link[1]))+'">'+esc(cleanText(link[0]))+'</a>';
  }).join(separator===undefined?'<br>':esc(separator));
  return v20Node('ds-blocks/simple-text',{},[
    Object.assign(v20Node('core/paragraph',{}),{text:html})
  ]);
}

function v20Paragraph(text){
  return v20Node('ds-blocks/simple-text',{},[
    Object.assign(v20Node('core/paragraph',{}),{text:cleanText(text)})
  ]);
}

/** The menu locations the theme declares, and what the builder puts in each. */
var V20_MENUS={primary:'primary-menu',secondary:'footer-secondary',tertiary:'footer-tertiary'};

function v20MenuBlock(location,context,extra){
  return v20Node('ds-blocks/dst-navigation-menu',Object.assign({
    menuSource:'location',
    menuLocation:location,
    menuContext:context
  },extra||{}));
}

/**
 * The site logo.
 *
 * `logoSource: 'inline'` with `inlineSvgLogo` is how the theme takes a mark that
 * is not an uploaded file, which is what the builder has: an initials mark it
 * drew itself. A real logo URL becomes `customLogoId` at import, once the file
 * has been sideloaded and has an attachment id.
 */
function v20Logo(project,context){
  var header=project.header,url=cleanText(header.logoUrl);
  var attributes={logoContext:context};
  // A media object with a `url`, because that is the shape the importer's
  // sideloader walks: it fetches the file, writes the attachment id back into the
  // `id` key, and the converter turns that into `customLogoId`. A bare
  // `logoUrl` string would never be fetched and would point at wherever the
  // strategist got it from.
  if(url){attributes.logoSource='custom';attributes.customLogo={id:0,url:url,alt:cleanText(header.logoText||''),mimeType:'',mediaType:'image',size:'full'}}
  else{
    attributes.logoSource='inline';
    attributes.inlineSvgLogo=v20InitialsSvg(header.logoMark||v2Initials(header.logoText||project.brief.clientName),project);
  }
  if(context==='footer'){attributes.logoWidth='187px';attributes.logoHeight='136px'}
  return v20Node('ds-blocks/dst-site-logo',attributes);
}

/** The initials mark, as an SVG the theme can hold inline. */
function v20InitialsSvg(mark,project){
  var text=esc(String(mark||'').slice(0,3).toUpperCase()),
    ink=project.design.palette.accent;
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40" role="img" aria-label="'+text+'">'+
    '<text x="0" y="30" font-family="Inter, system-ui, sans-serif" font-size="28" font-weight="700" fill="'+escAttr(ink)+'">'+text+'</text></svg>';
}

/**
 * The navigation, as the theme builds it.
 *
 * Every attribute name here is one `ds-blocks/dst-navigation` and its children
 * actually declare — checked against the theme's own `block.json` rather than
 * invented, because an attribute the block does not know is an attribute the
 * editor will not show and WordPress will not render.
 */
function v20NavigationNode(project){
  var header=project.header,announcement=cleanText(header.announcement||header.announcementText||'');
  var attributes={
    displayType:header.position||'sticky',
    frostedGlass:!!header.frostedGlass,
    hideOnScrollDown:!!header.hideOnScrollDown,
    useAnnouncementBar:!!announcement,
    announcementBarDismissible:!!header.announcementDismissible,
    showTopNavigation:false,
    showBottomNavigation:false,
    dsContainerAlign:'center',
    innerContainerWidth:'container',
    metadata:{name:'Header'}
  };
  var children=[];
  if(announcement){
    children.push(v20Node('ds-blocks/dst-navigation-announcement',{},[v20Paragraph(announcement)]));
  }
  children.push(v20Node('ds-blocks/dst-navigation-top',{}));
  children.push(v20Node('ds-blocks/dst-navigation-main',{},[
    v20Node('ds-blocks/dst-navigation-content',{navigationArea:'logo',className:'site-header__col -left',metadata:{name:'Main Left Blocks Area'}},[v20Logo(project,'header')]),
    v20Node('ds-blocks/dst-navigation-content',{navigationArea:'menu',className:'site-header__col -center',metadata:{name:'Main Center Blocks Area'}},[v20MenuBlock(V20_MENUS.primary,'header',{orientation:'horizontal'})]),
    v20Node('ds-blocks/dst-navigation-content',{navigationArea:'search',className:'site-header__col -right',metadata:{name:'Main Right Blocks Area'}},v20HeaderRight(project))
  ]));
  children.push(v20Node('ds-blocks/dst-navigation-mobile',{},[
    v20Node('ds-blocks/dst-navigation-content',{navigationArea:'logo',className:'site-header__widget',metadata:{name:'Mobile Blocks Area'}},[v20Logo(project,'header')]),
    v20Node('ds-blocks/dst-navigation-mobile-dropdown',{},[
      // The phone takeover the strategist chose is a class on the dropdown, and
      // the burger itself is the menu block's own concern.
      v20MenuBlock(V20_MENUS.primary,'header',{isBurgerMenu:true,enableMobileAccordion:true,orientation:'vertical'})
    ])
  ]));
  children.push(v20Node('ds-blocks/dst-navigation-bottom',{}));

  var node=v20Node('ds-blocks/dst-navigation',attributes,children);
  node.id='site-header';
  node.usage='header';
  node.role='header';
  // The takeover style is a builder concept with no attribute behind it, so it
  // travels as a class the theme's stylesheet can hook and the importer keeps.
  node.attributes.className=('site-header mobile-menu--'+mobileMenuStyle(header.mobileMenu)).trim();
  return node;
}

/** Whatever the right-hand column of the header holds. */
function v20HeaderRight(project){
  var header=project.header,out=[];
  if(header.showSearch!==false)out.push(v20Node('ds-blocks/dst-navigation-search',{searchType:'overlay'}));
  var cta=header.cta&&cleanText(header.cta.text);
  if(cta){
    out.push(v20Node('ds-blocks/button-group',{justifyContent:'flex-end'},[
      v20Node('ds-blocks/c-btn',{text:cta,btnType:'primary',link:{url:normalizeLink(header.cta.link||'#contact'),opensInNewTab:false,title:''},hasIcon:false,iconPosition:'row-reverse'})
    ]));
  }
  return out;
}

/**
 * The footer, as the theme builds it.
 *
 * Three sections, because the block has three: `enabledRows` says which of them
 * render and each `dst-footer-section` names which one it is. The builder's own
 * five footer layouts differ in which rows they enable and how the middle row is
 * divided, which is a real mapping rather than a shorthand for the importer to
 * interpret.
 */
function v20FooterNode(project){
  var footer=project.footer,design=project.design,statement=cleanText(footer.statement),
    variant=cleanText(footer.variant)||'editorial',
    columns=(footer.columns||[]).slice(0,4);

  var attributes={
    enabledRows:{top:!!statement,middle:true,bottom:true},
    backgroundColor:design.palette.dark,
    dsPadding:{top:{type:'default',desktop:'',mobile:''},bottom:{type:'default',desktop:'',mobile:''}},
    innerContainerWidth:'container',
    metadata:{name:'Footer'},
    className:'sbs-footer footer-'+variant
  };

  var sections=[];
  if(statement){
    sections.push(v20Node('ds-blocks/dst-footer-section',{
      sectionArea:'top',
      separatorBelow:true,
      separatorHeight:'1px',
      separatorColor:'rgba(255,255,255,0.18)',
      metadata:{name:'Footer Top'}
    },[
      v20Node('ds-blocks/dst-footer-slot',{metadata:{name:'Statement'}},[
        v20Node('ds-blocks/dst-block-title',{text:statement,titleTypography:{tag:'div',preset:'h2-style'},metadata:{name:'Closing statement'}}),
        cleanText(footer.description)?v20Paragraph(footer.description):null
      ].filter(Boolean))
    ]));
  }

  var middle=[v20Node('ds-blocks/dst-footer-slot',{metadata:{name:'Brand'}},[
    v20Logo(project,'footer'),
    v20Node('core/spacer',{height:'2rem'}),
    v20Node('ds-blocks/dst-social-networks',{
      socialSource:'custom',
      layoutDirection:'horizontal',
      alignDesktop:'flex-start',
      alignMobile:'center',
      showSocialTitle:true,
      socialTitleText:'Follow us',
      socialIconGap:'1.2rem',
      socialNetworks:(footer.socials||[]).map(function(entry,index){
        var network=Array.isArray(entry)?entry[0]:entry&&entry.network,
          url=Array.isArray(entry)?entry[1]:entry&&entry.url;
        return {id:'social-'+(index+1),network:cleanText(network||'linkedin'),label:cleanText(network||'LinkedIn'),url:normalizeLink(url||'#')};
      })
    })
  ])];

  columns.forEach(function(column,index){
    // The first two menu columns take the theme's own secondary and tertiary
    // locations; anything past those is written as links, because the theme has
    // no third footer location to put them in.
    var location=index===0?V20_MENUS.secondary:index===1?V20_MENUS.tertiary:'';
    middle.push(v20Node('ds-blocks/dst-footer-slot',{metadata:{name:cleanText(column.title)||'Column '+(index+2)}},[
      v20Node('ds-blocks/dst-block-title',{text:cleanText(column.title)||'',titleTypography:{tag:'div',marginBottom:''}}),
      location
        ? v20MenuBlock(location,'footer',{orientation:'vertical',enableMobileAccordion:true})
        // `c-list-item` has no link attribute — the theme's own footer part puts
        // link columns in a paragraph, which is also the only way the anchors
        // survive as anchors.
        : v20Links(column.links)
    ]));
  });
  sections.push(v20Node('ds-blocks/dst-footer-section',{
    sectionArea:'middle',
    columnsTablet:2,
    columnsMobile:1,
    rowGap:'3rem',
    metadata:{name:'Footer Middle'}
  },middle));

  sections.push(v20Node('ds-blocks/dst-footer-section',{
    sectionArea:'bottom',
    columnsTablet:1,
    columnsMobile:1,
    rowGap:'2rem',
    verticalAlign:'center',
    separatorAbove:true,
    separatorHeight:'1px',
    separatorColor:'rgba(255,255,255,0.18)',
    metadata:{name:'Footer Bottom'}
  },[
    v20Node('ds-blocks/dst-footer-slot',{metadata:{name:'Legal'}},[v20Paragraph(footer.legal)]),
    v20Node('ds-blocks/dst-footer-slot',{textAlign:'right',metadata:{name:'Privacy'}},[
      v20Links(footer.privacyLinks,' · ')
    ])
  ]));

  var node=v20Node('ds-blocks/dst-footer',attributes,sections);
  node.id='site-footer';
  node.usage='footer';
  node.role='footer';
  node.inverted=true;
  return node;
}

/**
 * The menus the importer has to create, and where each one belongs.
 *
 * Carried beside the block trees rather than inside them: a WordPress menu is a
 * taxonomy term, not block content, and the blocks reference it by the location
 * it is assigned to.
 */
function v20MenuPlan(project){
  var header=project.header,footer=project.footer,columns=footer.columns||[];
  var plan=[{
    location:V20_MENUS.primary,
    name:'Primary menu',
    items:(header.nav||[]).map(function(entry){return {label:cleanText(entry[0]),url:normalizeLink(entry[1])}})
  }];
  [0,1].forEach(function(index){
    var column=columns[index];
    if(!column)return;
    plan.push({
      location:index===0?V20_MENUS.secondary:V20_MENUS.tertiary,
      name:cleanText(column.title)||'Footer menu '+(index+1),
      items:(column.links||[]).map(function(link){return {label:cleanText(link[0]),url:normalizeLink(link[1])}})
    });
  });
  return plan.filter(function(entry){return entry.items.length});
}

var headerExportBeforeV20=headerExport;
headerExport=function(project){
  V20_ID=0;
  var node=v20NavigationNode(project);
  // The shorthand is kept beside the tree, not instead of it: it is what the
  // 1.0 importer reads, and an older plugin should degrade to the old behaviour
  // rather than import nothing at all.
  var legacy=headerExportBeforeV20(project);
  node.menus=v20MenuPlan(project);
  /*
   * The shorthand rides along on the node.
   *
   * It is not an attribute and never reaches WordPress, but it is the builder's
   * own record of what the header holds — the concept round-trip and the QA
   * scripts read it — and a 1.0 plugin degrades to it rather than importing
   * nothing at all.
   */
  node.nav=legacy.nav;
  node.legacyShorthand=legacy.nav;
  node.note='Canonical ds-blocks/dst-navigation tree, matching the theme part. `menus` names the WordPress menu each block location expects.';
  return node;
};

var footerExportBeforeV20=footerExport;
footerExport=function(project){
  var node=v20FooterNode(project);
  var legacy=footerExportBeforeV20(project);
  node.legacyShorthand=legacy.footer;
  node.note='Canonical ds-blocks/dst-footer tree, matching the theme part.';
  return node;
};

/* ---------------------------------------------------------------- *
 * A stats band with real figures in it
 *
 * The writer used to be told to leave every number empty and write "Add the
 * measured figure" where it belonged, which is the safe answer and an
 * unpresentable one: three cards reading "Add the measured figure" is a template,
 * not a concept. The prompt now asks for an illustrative figure in the unit the
 * industry actually uses, and this is the net under it — for the built-in planner,
 * for a model that ignores the instruction, and for the demo content nobody has
 * run the writer over yet.
 *
 * Deliberately narrow. A unit is taken from the brief's own words and the
 * magnitude is round and obviously a placeholder, and nothing here produces a
 * figure that reads as an audited claim: no percentages of satisfaction, no
 * review scores, no revenue, no headcount, no years trading. The band says in
 * its own body that the figures are illustrative.
 * ---------------------------------------------------------------- */

/*
 * Units, by what the brief talks about. First match wins, so the more specific
 * trades come before the general ones.
 */
var V19_UNITS=[
  {terms:['motorcycle','motorbike','bike','rental','tour','ride','fleet','vehicle','car','truck','logistics','delivery','courier'],figures:['2,000 km','48 hrs','12 routes']},
  {terms:['dental','clinic','medical','health','patient','therapy','care','veterinar'],figures:['3 clinics','24 hrs','8 treatments']},
  {terms:['restaurant','cafe','food','menu','kitchen','catering','bakery','brewery'],figures:['40 covers','12 dishes','3 sittings']},
  {terms:['construction','build','contractor','roofing','plumbing','electrical','install','renovation','landscap'],figures:['120 projects','14 sites','48 hrs']},
  {terms:['law','legal','accounting','tax','advisory','consult','audit','compliance'],figures:['3 practices','48 hrs','9 sectors']},
  {terms:['saas','software','platform','app','api','data','cloud','engineering','developer'],figures:['99.9% uptime','< 200 ms','12 integrations']},
  {terms:['school','course','training','academy','education','learning','student'],figures:['24 courses','12 weeks','6 cohorts']},
  {terms:['property','estate','realty','housing','architect','interior'],figures:['40 properties','3 regions','18 months']},
  {terms:['retail','shop','store','ecommerce','brand','product','merch'],figures:['400 lines','48 hrs','9 markets']},
  {terms:['travel','hotel','hospitality','resort','tourism','guest'],figures:['3 languages','24 hrs','40 rooms']}
];
var V19_UNITS_FALLBACK=['3 services','48 hrs','12 markets'];

/** The illustrative figures this brief's own vocabulary suggests. */
function v19StatsFigures(){
  var brief=state.project.brief||{},
    corpus=[brief.industry,brief.offer,brief.goal,brief.keywords,brief.audience,brief.projectName,brief.clientName]
      .join(' ').toLowerCase();
  for(var i=0;i<V19_UNITS.length;i++){
    for(var t=0;t<V19_UNITS[i].terms.length;t++){
      if(corpus.indexOf(V19_UNITS[i].terms[t])>=0)return V19_UNITS[i].figures;
    }
  }
  return V19_UNITS_FALLBACK;
}

/** True when a value is an instruction to the strategist rather than a figure. */
function v19IsInstruction(value){
  var text=String(value||'').trim();
  if(!text)return true;
  // A figure contains a digit. "Add the measured figure", "TBC", "Metric" do not.
  if(/\d/.test(text))return false;
  return true;
}

var V19_STATS_NOTE='These figures are illustrative for the concept — confirm them before publishing.';

var v3ApplyItemsBeforeV19=v3ApplyItems;
v3ApplyItems=function(section,items){
  var result=v3ApplyItemsBeforeV19(section,items);
  if(!section||section.family!=='stats')return result;
  var figures=v19StatsFigures(),list=section.content&&section.content.items;
  if(!Array.isArray(list))return result;
  list.forEach(function(item,index){
    if(v19IsInstruction(item.value))item.value=figures[index%figures.length];
  });
  // Said once, on the band itself, rather than left for somebody to notice.
  var body=cleanText(section.content.body||'');
  if(body&&!/illustrative|demonstration/i.test(body))section.content.body=body+' '+V19_STATS_NOTE;
  else if(!body)section.content.body=V19_STATS_NOTE;
  return result;
};

/* ================================================================== *
 * v18 — A band's text tone follows its overlay, and a logo rail is editable
 *
 * Two things the pattern library brought with it from the site it was exported
 * from, and one thing the builder was deciding on the wrong evidence.
 *
 * **The tone.** A hero's `is-style-colors-inverted` came from the family preset —
 * every hero is inverted, because a hero is usually a photograph. The overlay
 * came from the pattern, and five of them fade something *pale* across the band
 * and put the headline in it. The band class carries `!important` colour rules,
 * so it won the argument the heading renderer had already settled correctly:
 * white type on a near-white ground. The overlay is the fact and the preset is a
 * guess, so the class now follows the overlay.
 *
 * **The logo rail.** `marquee.images` listed seven real client logos by URL from
 * the exporting site. They are gone from the data; what remains is a set of
 * inline placeholder marks drawn in `currentColor`, and a panel for putting real
 * logos in — which is what a logo rail needs and did not have.
 * ================================================================== */

/**
 * The overlay a band will actually render with.
 *
 * Not the pattern's stored value: `syncSectionNode` replaces a banner's overlay
 * with the builder's own, and the fidelity surface then re-applies whatever it
 * captured. Reading the attribute after both have run is the only way to see
 * what the visitor gets.
 */
function v18BannerOverlay(section){
  var node=section&&section.node;
  if(!node)return null;
  var banner=node.component==='ds-blocks/dst-banner'?node:firstNode(node,'ds-blocks/dst-banner');
  if(!banner)return null;
  var attrs=banner.attributes||{};
  if(attrs.backgroundOverlayEnabled===false)return null;
  var value=cleanCssValue(attrs.backgroundOverlay);
  if(!value)return null;
  var opacity=Number(attrs.backgroundOverlayOpacity);
  return {value:value,opacity:Number.isFinite(opacity)?opacity:1};
}

/*
 * The value a photograph is assumed to hold where nobody has seen it.
 *
 * Mid-grey is the only honest stand-in: it is the one value that makes neither
 * ink a gamble, so a wash judged against it has to actually carry the copy
 * rather than borrow the luck of a light or dark picture.
 */
var V18_PHOTO_GREY=128;

/** One colour stop as channels and alpha, for the values these washes use. */
function v18StopRgba(stop,project){
  var raw=String(stop||'').trim();
  var rgb=raw.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if(rgb)return {rgb:[Number(rgb[1]),Number(rgb[2]),Number(rgb[3])],alpha:v2ColorAlpha(raw)};
  if(/^transparent$/i.test(raw))return {rgb:[V18_PHOTO_GREY,V18_PHOTO_GREY,V18_PHOTO_GREY],alpha:0};
  var hex=v2SurfaceColor(raw,project);
  if(!hex)return null;
  return {rgb:hexRgb(hex),alpha:v2ColorAlpha(raw)};
}

/*
 * The ground a wash lays over the picture, taken at its weakest point.
 *
 * A gradient is judged where it gives the copy least, not where it gives most:
 * the words can sit anywhere in the band, so the thinnest part of the wash is
 * the part that has to hold them.
 */
function v18WashGround(overlay,project){
  var raw=String(overlay.value||'');
  var stops=/gradient\(/i.test(raw)
    ? (raw.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b|var\(\s*--[a-z0-9-]+\s*\)|\btransparent\b/ig)||[])
    : [raw];
  var fold=Number.isFinite(overlay.opacity)?clamp(overlay.opacity,0,1):1,weakest=null;
  for(var i=0;i<stops.length;i++){
    var parsed=v18StopRgba(stops[i],project);
    if(!parsed)continue;
    var effective=parsed.alpha*fold;
    if(!weakest||effective<weakest.alpha)weakest={alpha:effective,rgb:parsed.rgb};
  }
  if(!weakest)return null;
  return weakest.rgb.map(function(channel){
    return channel*weakest.alpha+V18_PHOTO_GREY*(1-weakest.alpha);
  });
}

/** Relative luminance of channels already in 0–255. */
function v18Luminance(rgb){
  return rgb.map(function(channel){
    var value=channel/255;
    return value<=.03928?value/12.92:Math.pow((value+.055)/1.055,2.4);
  }).reduce(function(total,value,index){return total+value*[.2126,.7152,.0722][index]},0);
}

function v18Contrast(a,b){
  var high=Math.max(v18Luminance(a),v18Luminance(b)),low=Math.min(v18Luminance(a),v18Luminance(b));
  return (high+.05)/(low+.05);
}

/**
 * The tone a banner section should carry, or null to leave the preset alone.
 *
 * Returns true for "needs light text", false for "needs dark text".
 *
 * This used to be a threshold: a light wash counted as the ground only above .45
 * opacity, and anything below kept the band's inverted preset while "the
 * rendered-legibility pass has the last word" — a pass that does not exist. That
 * left a middle where `sbs-hero-p89-v2`, a 27% white wash over a photograph, kept
 * its white copy and measured 1.17:1 against the rendered pixels.
 *
 * So no threshold. Mix the wash over a mid-grey picture and return whichever ink
 * reads better on the result. A wash the client weakens in the editor now moves
 * the copy with it instead of falling into a gap.
 */
function v18BannerTone(section){
  var overlay=v18BannerOverlay(section);
  if(!overlay)return null;
  var ground=v18WashGround(overlay,state.project);
  if(!ground){
    var dark=v2SurfaceTone(overlay.value,state.project);
    return dark==null?null:!!dark;
  }
  var palette=state.project.design&&state.project.design.palette||{};
  return v18Contrast(ground,[247,245,239])>=v18Contrast(ground,hexRgb(palette.dark||'#111111'));
}

/*
 * The band's tone class, corrected.
 *
 * `sectionClasses` builds it from `layout.inverted`, and the tone wrapper
 * appends the standard token when that is false. Both are replaced here for a
 * banner whose overlay says otherwise, so the class the `!important` rules hang
 * off agrees with the heading renderer instead of overruling it.
 */
var sectionClassesBeforeV18=sectionClasses;
sectionClasses=function(section){
  var classes=sectionClassesBeforeV18(section),tone=v18BannerTone(section);
  if(tone==null)return classes;
  var wanted=tone?'is-style-colors-inverted':'is-style-colors-standard';
  var stripped=classes.split(/\s+/).filter(function(name){
    return name&&name!=='is-style-colors-inverted'&&name!=='is-style-colors-standard'&&name!=='is-pale-overlay';
  });
  stripped.push(wanted);
  /*
   * A named class for the pale case, not just the standard tone.
   *
   * `is-style-colors-standard` is on *every* band that is not inverted — most of
   * the page. A rule that paints copy in the palette's dark role has to apply
   * only where the ground is a pale *wash over a photograph*, because on an
   * ordinary band the dark role is the band's own background: forcing it produced
   * 1:1 contrast and the legibility audit caught 78 of them.
   */
  if(!tone)stripped.push('is-pale-overlay');
  return stripped.join(' ');
};

/*
 * The band's ground class follows too.
 *
 * `sbs-band-dark` paints the fallback colour behind the photograph and is chosen
 * from the same preset. A pale-overlay hero given a dark ground flashes dark
 * before the image loads and shows dark at the edges of a contained one.
 */
var sectionBgClassBeforeV18=sectionBgClass;
sectionBgClass=function(section,index){
  var base=sectionBgClassBeforeV18(section,index),tone=v18BannerTone(section);
  if(tone==null||tone)return base;
  return base==='sbs-band-dark'?'sbs-band-paper':base;
};

/* ---------------------------------------------------------------- *
 * The logo rail
 * ---------------------------------------------------------------- */

/** An inline placeholder mark, or a real logo, or nothing at all. */
function v18RenderLogo(entry){
  if(!entry||typeof entry!=='object')return '';
  var alt=entry.alt||entry.caption||'Client logo';
  if(typeof entry.svg==='string'&&entry.svg){
    // Inline rather than an `<img src="data:…">`: the mark is drawn in
    // `currentColor`, so it inherits the band's text colour and reads on a dark
    // overlay and a light one without shipping two sets of files.
    return '<span class="dst-marquee__img is-placeholder" role="img" aria-label="'+escAttr(alt)+'">'+entry.svg+'</span>';
  }
  var media=v2MediaObject(entry);
  if(media&&media.src)return '<img class="dst-marquee__img" src="'+escAttr(media.src)+'" alt="'+escAttr(media.alt||alt)+'">';
  return '<span class="dst-marquee__logo">'+esc(entry.label||alt)+'</span>';
}

var renderNodeBeforeV18=renderNode;
renderNode=function(node,ctx){
  if(!node||node.component!=='ds-blocks/marquee')return renderNodeBeforeV18(node,ctx);
  var attrs=node.attributes||{},logos=(Array.isArray(attrs.images)?attrs.images:[]).filter(Boolean);
  if(!logos.length)logos=v18PlaceholderLogos();
  // Twice, so the track can scroll without a gap appearing behind it.
  var run=logos.concat(logos);
  return '<div class="dst-marquee" data-dst-component="'+escAttr(node.component)+'">'+
    '<div class="dst-marquee__track" style="--dur:'+(Number(attrs.speed)||28)+'s">'+
    run.map(v18RenderLogo).join('')+'</div></div>';
};

/**
 * The placeholder set, for a rail whose logos have all been removed.
 *
 * Read out of the library rather than written twice: the same six marks the
 * patterns ship, so the rail never renders empty and never invents a seventh.
 */
var v18PlaceholderCache=null;
function v18PlaceholderLogos(){
  if(v18PlaceholderCache)return v18PlaceholderCache;
  var found=null;
  DATA.patterns.forEach(function(pattern){
    if(found)return;
    (function walk(node){
      if(found||!node)return;
      if(node.component==='ds-blocks/marquee'){
        var images=(node.attributes||{}).images;
        if(Array.isArray(images)&&images.length&&images[0].svg)found=deepClone(images);
      }
      (node.children||[]).forEach(walk);
    })(pattern.tree);
  });
  v18PlaceholderCache=found||[];
  return v18PlaceholderCache;
}

/** The first marquee in a module, if it has one. */
function v18Marquee(section){
  if(!section||!section.node)return null;
  return section.node.component==='ds-blocks/marquee'?section.node:firstNode(section.node,'ds-blocks/marquee');
}

function v18Logos(section){
  var node=v18Marquee(section);
  if(!node)return null;
  node.attributes=node.attributes||{};
  if(!Array.isArray(node.attributes.images))node.attributes.images=[];
  return node.attributes.images;
}

/**
 * The logo panel, shown only on a module that has a rail.
 *
 * A URL each, because that is what a logo is: a file somebody has already
 * exported. An empty row is a placeholder mark rather than a hole, so a rail
 * being filled in one logo at a time never looks broken halfway through.
 */
function v18LogoPanel(section){
  var logos=v18Logos(section);
  if(!logos)return '';
  var rows=logos.map(function(entry,index){
    var media=v2MediaObject(entry),src=media&&media.src||'';
    return '<div class="repeat-row">'+
      '<input data-logo-index="'+index+'" data-logo-key="src" value="'+escAttr(src)+'" placeholder="https://… .svg or .png">'+
      '<input data-logo-index="'+index+'" data-logo-key="alt" value="'+escAttr(entry.alt||'')+'" placeholder="Company name">'+
      '<button class="mini-btn danger" data-logo-remove="'+index+'" title="Remove this logo">'+ICONS.trash+'</button>'+
    '</div>';
  }).join('');
  return fidelityGroup('Logos in the rail','An SVG or PNG each — a transparent SVG reads best over a photograph. Leave the address empty to keep the placeholder mark, which is drawn in the band’s own text colour.',
    '<div class="repeater full">'+rows+
      '<button class="add-row" data-logo-add>Add a logo</button>'+
    '</div>');
}

var renderMediaEditorBeforeV18=renderMediaEditor;
renderMediaEditor=function(section){
  return renderMediaEditorBeforeV18(section)+v18LogoPanel(section);
};

byId('editorInner').addEventListener('input',function(event){
  var input=event.target;
  if(!input||!input.dataset||input.dataset.logoIndex==null)return;
  var section=currentSection(),logos=section?v18Logos(section):null;
  if(!logos)return;
  var entry=logos[Number(input.dataset.logoIndex)];
  if(!entry)return;
  inputCheckpoint();
  if(input.dataset.logoKey==='alt')entry.alt=input.value;
  else{
    var url=cleanText(input.value);
    if(url){entry.src=url;entry.url=url;delete entry.svg;delete entry.placeholder}
    // Cleared: back to the placeholder mark rather than an empty gap in the rail.
    else{delete entry.src;delete entry.url;var marks=v18PlaceholderLogos();var mark=marks[Number(input.dataset.logoIndex)%(marks.length||1)];if(mark){entry.svg=mark.svg;entry.placeholder=true;if(!entry.alt)entry.alt=mark.alt}}
  }
  queueSave();
  v12QueuePaint(section);
});

byId('editorInner').addEventListener('click',function(event){
  var add=event.target.closest('[data-logo-add]'),remove=event.target.closest('[data-logo-remove]');
  if(!add&&!remove)return;
  var section=currentSection(),logos=section?v18Logos(section):null;
  if(!logos)return;
  inputCheckpoint();
  if(remove)logos.splice(Number(remove.dataset.logoRemove),1);
  else{
    var marks=v18PlaceholderLogos(),mark=marks[logos.length%(marks.length||1)]||{};
    logos.push({svg:mark.svg||'',alt:mark.alt||'Client logo placeholder',placeholder:true});
  }
  queueSave();
  renderEditor();
  v12QueuePaint(section);
  announce(remove?'Logo removed.':'Logo added — paste its address, or leave the placeholder.');
});

/*
 * An empty media slot takes the project's own imagery.
 *
 * The library's cards used to name a file on the site the patterns were exported
 * from, which won over the imagery the builder found for *this* brief simply by
 * being present. Those files are gone and the slots are not: an empty `media`
 * object says "this card has a picture and does not have a file yet". Filling it
 * here, at sync, means the preview, the audit and the export all see the same
 * picture — the one the imagery pass placed, or the labelled placeholder that
 * stands in until it runs.
 */
var V18_MEDIA_SLOTS=['ds-blocks/c-card-item','ds-blocks/c-media','ds-blocks/l-content-2','ds-blocks/c-accordion','ds-blocks/c-accordion-item','ds-blocks/dst-wrapper','ds-blocks/ds-columns','ds-blocks/dst-banner','ds-blocks/c-cards','ds-blocks/c-list'];
function v18FillEmptySlots(section){
  if(!section||!section.node)return;
  var index=0;
  walkNode(section.node,function(node){
    if(V18_MEDIA_SLOTS.indexOf(node.component)<0)return;
    var attrs=node.attributes=node.attributes||{};
    var slot=index++;
    var chosen=null;
    if('media' in attrs&&!(attrs.media&&typeof attrs.media==='object'&&Object.keys(attrs.media).length)){
      chosen=mediaChoice(section,slot);
      if(chosen)attrs.media=asMedia(chosen);
    }
    // A photo-backed band says so with the list, not with what is in it.
    if(Array.isArray(attrs.backgroundImage)&&!attrs.backgroundImage.length){
      chosen=chosen||mediaChoice(section,slot);
      if(chosen)attrs.backgroundImage=[asMedia(chosen)];
    }
  });
}

var syncSectionNodeBeforeV18=syncSectionNode;
syncSectionNode=function(section){
  syncSectionNodeBeforeV18(section);
  v18FillEmptySlots(section);
};

/*
 * A card grid with no column count.
 *
 * `fidelityNumber(undefined, 1, 6)` is one column, so a thirteen-card pattern
 * rendered as thirteen full-width bands. The pattern data now states the count,
 * and this is the net under it for a pattern added later: what the grid holds,
 * capped at the three a card is designed around.
 */
var fidelityEnsureSectionBeforeV18=fidelityEnsureSection;
fidelityEnsureSection=function(section){
  var fidelity=fidelityEnsureSectionBeforeV18(section);
  if(!fidelity||!fidelity.cards)return fidelity;
  var cards=fidelityNode(section,['ds-blocks/c-cards']),attrs=cards&&cards.attributes||{};
  if(Number(attrs.columnsDesktop)||Number(attrs.columns))return fidelity;
  if(fidelity.cards.desktop>1)return fidelity;
  var held=(cards&&cards.children||[]).filter(function(child){return child.component==='ds-blocks/c-card-item'}).length;
  if(held>1)fidelity.cards.desktop=Math.min(3,held);
  return fidelity;
};

/* ================================================================== *
 * v17 — A document is attached, not pasted
 *
 * Dropping the client's PDF used to tip its whole text into the brief textarea.
 * That is the wrong place for it twice over: three pages of somebody else's
 * document buries the paragraph the strategist wrote in a box they are meant to
 * keep editing, and it makes a *document* look like something they typed.
 *
 * So a document is now attached. It shows as its own name with its kind and its
 * length, next to a button that removes it. The words never enter the textarea —
 * they go to the brain, which reads the paragraph and every attachment together
 * (`briefSourceText`), so one press of "Read my brief and build 3 concepts" sees
 * the lot.
 *
 * Which means an attachment on its own is a brief: the button's gate, the
 * character counter and the stale-concepts check all measure the paragraph and
 * the attachments together, so a client who sent a PDF and nothing else does not
 * have to retype it to get started.
 * ================================================================== */

/*
 * A page with a corner turned down, and a mark that says which kind of document
 * it is. The kinds are the ones `briefDocumentKind` returns, so the icon and the
 * label cannot describe a kind the reader does not produce.
 */
var V17_SHEET='<path d="M6 2h7l5 5v15H6z"/><path d="M13 2v5h5"/>';
var V17_ICONS={
  pdf:V17_SHEET+'<path d="M9 13v5M9 13h1.6a1.2 1.2 0 0 1 0 2.4H9M13.4 18v-5h1.2a1.6 1.6 0 0 1 0 5z"/>',
  docx:V17_SHEET+'<path d="M9 13h6M9 16h6M9 19h3"/>',
  rtf:V17_SHEET+'<path d="M9 13h6M9 16h4"/>',
  plain:V17_SHEET+'<path d="M9 12h6M9 15h6M9 18h4"/>'
};
var V17_KIND_LABELS={pdf:'PDF',docx:'Word document',rtf:'Rich text',plain:'Text file'};

function v17Icon(kind){
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" '+
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+
    (V17_ICONS[kind]||V17_ICONS.plain)+'</svg>';
}

/** The attachments, as chips: an icon, the file name, and a way to take it off. */
function v17DocumentChips(attachments){
  var list=attachments||[];
  if(!list.length)return '';
  return '<ul class="brief-files" data-brief-files>'+list.map(function(file){
    var kind=V17_KIND_LABELS[file.kind]||'Document',
      size=Number(file.characters)||0;
    return '<li class="brief-file" data-brief-file-id="'+escAttr(file.id)+'">'+
      '<span class="brief-file__icon">'+v17Icon(file.kind)+'</span>'+
      '<span class="brief-file__body">'+
        '<b title="'+escAttr(file.name)+'">'+esc(file.name)+'</b>'+
        '<span>'+esc(kind)+(size?' · '+size.toLocaleString()+' characters read':'')+'</span>'+
      '</span>'+
      '<button type="button" class="brief-file__remove" data-brief-file-remove="'+escAttr(file.id)+'" '+
        'aria-label="Remove '+escAttr(file.name)+' from the brief">&times;</button>'+
    '</li>';
  }).join('')+'</ul>';
}

/** Whatever the current builder has attached. */
function v17Attachments(){
  return typeof briefBrainFeature.briefAttachments==='function'
    ? briefBrainFeature.briefAttachments(state.project)
    : [];
}

/*
 * The drop zone, with the attachments under it.
 *
 * The panel passes its own list so the simple builder's re-render and the
 * advanced builder's panel show the same thing from the same markup; a caller
 * that passes nothing gets the current project's, which is what the advanced
 * panel wants.
 */
var v11BriefDropZoneBeforeV17=v11BriefDropZone;
v11BriefDropZone=function(attachments){
  var list=attachments===undefined?v17Attachments():attachments;
  return v11BriefDropZoneBeforeV17()+v17DocumentChips(list);
};

/** Removes one attachment, and says which. */
function v17DetachDocument(id){
  var simple=briefBrainFeature.ensureSimpleState(state.project);
  if(!simple||!Array.isArray(simple.briefFiles))return;
  var gone=simple.briefFiles.filter(function(file){return file.id===id})[0];
  if(!gone)return;
  simple.briefFiles=simple.briefFiles.filter(function(file){return file.id!==id});
  queueSave();
  renderEditor();
  announce(gone.name+' removed from the brief.');
}

document.addEventListener('click',function(event){
  var trigger=event.target.closest&&event.target.closest('[data-brief-file-remove]');
  if(!trigger)return;
  event.preventDefault();
  v17DetachDocument(trigger.dataset.briefFileRemove);
});

/**
 * Reading dropped files into attachments.
 *
 * The document's own text is stored on the attachment rather than merged into
 * anything, which is what lets it be removed again cleanly — and what keeps the
 * strategist's paragraph theirs.
 *
 * In the advanced builder the individual brief fields are still filled from the
 * document, because that builder is unusable without them. What has changed is
 * that the internal note is left alone: it used to be overwritten with the whole
 * document, which is the same "pasted into a textarea" problem in a different box.
 */
v11ReadBriefFiles=async function(files){
  var list=Array.prototype.slice.call(files||[]);
  if(!list.length)return;
  if(list.length===1&&await v11IsConceptJson(list[0])){v4ImportConcept(list[0]);return}
  announce(list.length===1?'Reading '+list[0].name+'…':'Reading '+list.length+' documents…');

  var result;
  try{
    // No `existing`: an attachment is its own document, not an addition to a
    // paragraph, and the per-document limit is what matters here.
    result=await readBriefDocuments(list,{});
  }catch(error){
    announce('Those files could not be read.');
    return;
  }
  if(!result.read.length){
    announce(v11SkippedMessage(result.skipped.length?result.skipped:[{name:'That file',reason:'it held no text'}]));
    return;
  }

  var simple=briefBrainFeature.ensureSimpleState(state.project);
  simple.briefFiles=Array.isArray(simple.briefFiles)?simple.briefFiles:[];
  result.read.forEach(function(entry){
    var text=String(entry.text||'');
    // A file dropped twice is the same attachment, not two.
    simple.briefFiles=simple.briefFiles.filter(function(file){return file.name!==entry.name});
    simple.briefFiles.push({
      id:uid('brief-file'),
      name:entry.name,
      kind:entry.kind||'plain',
      characters:text.length,
      text:text
    });
  });
  queueSave();

  var names=result.read.map(function(entry){return entry.name}).join(', ');
  var tail=result.skipped.length?' '+v11SkippedMessage(result.skipped):'';
  var attached=result.read.length===1
    ? names+' attached to the brief.'
    : result.read.length+' documents attached to the brief: '+names+'.';

  if(v4IsSimple()){
    goStep(0);
    renderEditor();
    announce(attached+' Read the brief to build the three concepts.'+tail);
    return;
  }

  // The advanced builder needs the fields themselves, so the attachment's words
  // still go through the splitter — but only the fields are written.
  var source=typeof briefBrainFeature.briefSourceText==='function'
    ? briefBrainFeature.briefSourceText(state.project)
    : result.text;
  var expanded=typeof briefBrainFeature.expandBriefForImport==='function'
    ? await briefBrainFeature.expandBriefForImport(source)
    : null;
  var split=!!(expanded&&!expanded.error);
  if(split)mutate(function(){v4ApplyBriefFields(expanded,{})},{message:''});
  goStep(0);
  renderEditor();
  announce(split
    ? attached+' The fields below were filled in from it — check them before continuing.'+tail
    : attached+' Splitting it into the fields needs the brief server, so fill them in yourself.'+tail);
};

/* ================================================================== *
 * v16 — Every control in the module editor lands in the export
 *
 * A sweep that drives every binding the module editor renders, for every family,
 * in both views, and checks the exported artifact afterwards found controls that
 * changed nothing at all. Each is fixed here at its own cause rather than hidden:
 *
 *   Content width on a banner   A banner is full-bleed by definition, so the
 *                               export pins its container to `full` — and the
 *                               control was writing to the pinned value. The
 *                               thing a banner actually has is an *inner*
 *                               container, which the preview already reads.
 *   Hero image treatment        A split hero was a class in the preview and
 *                               nothing in the export. DST already has the
 *                               attribute: the background layer's own `width`.
 *   Supporting text alignment   No DST attribute exists for it, so it moved the
 *                               preview and could never move WordPress. A
 *                               control that makes the preview lie is worse than
 *                               no control.
 *   Custom image / alt text     Offered on families whose pattern renders no
 *                               media slot, where there is nothing to change.
 *   List geometry               Offered on a module whose list had already been
 *                               rebuilt away, from a stale target recorded
 *                               before the rebuild.
 * ================================================================== */

/** The banner a module is rooted in, if it is rooted in one. */
function v16Banner(section){
  if(!section||!section.node)return null;
  return section.node.component==='ds-blocks/dst-banner'?section.node
    :firstNode(section.node,'ds-blocks/dst-banner');
}

/*
 * Content width, on a banner.
 *
 * `layout.container` is what the section band is; `innerContainerWidth` is how
 * wide the words are inside it. For every other component those are the same
 * control, which is why one binding drives both.
 */
var V16_INNER={alt:'container-alt',default:'container',wide:'container-wide',full:'container-fluid'};
function v16ApplyContainer(section){
  var banner=v16Banner(section);
  if(!banner)return false;
  banner.attributes=banner.attributes||{};
  banner.attributes.innerContainerWidth=V16_INNER[section.layout&&section.layout.container]||'container';
  return true;
}

/*
 * Hero image treatment.
 *
 * A split hero is a background that occupies part of the band, and the DST
 * background layer says so with its own `width` — the registered patterns write
 * `"width": "auto"` there. So the treatment is a real exported attribute rather
 * than a class only the preview understands.
 */
function v16ApplyHeroMedia(section){
  var banner=v16Banner(section);
  if(!banner)return false;
  banner.attributes=banner.attributes||{};
  // `syncSectionNode` writes the chosen media as one object; a pattern from the
  // library writes a list of layers. Both are a background.
  var raw=banner.attributes.backgroundImage,
    layers=Array.isArray(raw)?raw:(raw&&typeof raw==='object'?[raw]:[]);
  if(!layers.length)return false;
  var mode=(section.layout&&section.layout.heroMediaMode)||'full',
    width=mode==='full'?'auto':'55%';
  layers.forEach(function(layer){
    if(!layer||typeof layer!=='object')return;
    layer.desktop=Object.assign({},layer.desktop,{width:width});
    // The phone always gets the whole band: a 55% background beside 45% of
    // nothing is not a composition, it is a gap.
    layer.mobile=Object.assign({},layer.mobile,{width:'auto'});
  });
  return true;
}

var syncSectionNodeBeforeV16=syncSectionNode;
syncSectionNode=function(section){
  syncSectionNodeBeforeV16(section);
  if(!section)return;
  v16ApplyContainer(section);
  v16ApplyHeroMedia(section);
  v16PruneFidelity(section);
};

/*
 * A fidelity slice for something the module no longer has.
 *
 * The slices are built from the pattern's pristine tree, and several families
 * then rebuild part of that tree from their own content model — the tabs family
 * replaces its panels wholesale. A slice recorded before the rebuild points at a
 * node that no longer exists, so its panel rendered controls with nowhere to
 * land. Pruning at sync means the panel is drawn from what the module *is*.
 */
var V16_SLICES=[['columns',['ds-blocks/ds-columns']],['cards',['ds-blocks/c-cards']],['list',['ds-blocks/c-list']]];
function v16PruneFidelity(section){
  var fidelity=section.fidelity;
  if(!fidelity)return;
  V16_SLICES.forEach(function(entry){
    var key=entry[0];
    if(!fidelity[key])return;
    if(!fidelityNode(section,entry[1]))fidelity[key]=null;
  });
}

/*
 * Supporting text alignment, withdrawn.
 *
 * `c-heading` has exactly one alignment pair — `alignment` and
 * `alignmentMobile` — and the builder's separate content alignment had no
 * attribute to become. It moved the preview and vanished on export, so a page
 * approved with centred supporting text arrived left-aligned. The heading
 * alignment, which does export, still moves both.
 */
var v3ResponsiveEditorBeforeV16=null;
var renderLayoutEditorExtendedBeforeV16=renderLayoutEditorExtended;
renderLayoutEditorExtended=function(section){
  var html=renderLayoutEditorExtendedBeforeV16(section);
  return v16DropContentAlign(html);
};
function v16DropContentAlign(html){
  // Removed from the rendered panel rather than from the six call sites that
  // build it, so the two fields cannot come back through a different one.
  return String(html).replace(/<div class="field(?: full)?">(?:(?!<\/div><div class="field)[\s\S])*?data-bind="setting\.[^"]*\.contentAlign(?:Mobile)?"[\s\S]*?<\/select><\/div>/g,'');
}

/*
 * The media fields, only where there is media.
 *
 * `Custom image URL` and `Image alt text` write into `content.media`, which six
 * families never render — their patterns have no media slot — so the fields
 * changed the project and nothing else. The slot list above them is already
 * derived from the pattern; these two now are as well.
 */
var renderMediaEditorBeforeV16=renderMediaEditor;
renderMediaEditor=function(section){
  var html=renderMediaEditorBeforeV16(section);
  if(!section)return html;
  var slots=[];
  try{slots=v5SectionSlots(section)||[]}catch(error){slots=[]}
  if(slots.length)return html;
  // Cut from the marker the base emits to the end of the base's own output —
  // later layers append their slot editors after it, and matching inside the
  // grid caught one field and left its neighbour behind.
  var mark=html.indexOf('data-bind="section.'+section.id+'.customMedia"');
  if(mark<0)return html;
  var open=html.lastIndexOf('<div class="field-grid"',mark);
  // The grid holds both fields, and the alt text is the second — so the close is
  // measured from there. Measuring from the first field cut one and left the
  // other, which is how the sweep caught this.
  var alt=html.indexOf('data-bind="section.'+section.id+'.mediaAlt"');
  var close=html.indexOf('</div></div>',alt>=0?alt:mark);
  if(open<0||close<0)return html;
  return html.slice(0,open)
    +'<div class="panel-note">This pattern renders no image or video slot, so there is nothing here to replace. Switch the pattern, or pick one that carries media.</div>'
    +html.slice(close+'</div></div>'.length);
};

/* ================================================================== *
 * v15 — The production form is a decision, not a constant
 *
 * Ten patterns in the library embed `gravityforms/form`, and every one of them
 * carries `formId: "1"` — captured from the DST staging site, exempt from the
 * registry filter, and passed straight through to WordPress. On the target site
 * form 1 is a different form or none at all, so the contact band imports empty.
 *
 * The id is the one thing about a form that has to be said out loud, and until
 * now there was nowhere to say it. So the contact editor asks, the preview slot
 * shows what it was told, and the export carries the answer.
 * ================================================================== */

/** The first Gravity Forms node in a module, or null. */
function v15FormNode(section){
  return section&&section.node?firstNode(section.node,'gravityforms/form'):null;
}

function v15FormAttrs(section){
  var node=v15FormNode(section);
  if(!node)return null;
  node.attributes=node.attributes||{};
  return node.attributes;
}

/**
 * The form panel, shown only where there is a form.
 *
 * A control for something the module does not have is worse than no control:
 * it invites a change that cannot land anywhere.
 */
function v15FormPanel(section){
  var attrs=v15FormAttrs(section);
  if(!attrs)return '';
  var id=attrs.formId==null?'':String(attrs.formId);
  return fidelityGroup('Production form','The Gravity Forms entry this band submits to. The id has to match the form on the site you are importing into — the pattern library ships the staging id, which is almost never the right one.',
    field('Gravity Forms id','form.'+section.id+'.formId',id,{help:'Find it in WordPress under Forms — the number in the list, or in the shortcode.'})+
    field('Show the form title','form.'+section.id+'.title',attrs.title?'true':'false',{type:'select',options:[{value:'false',label:'No — the band already has a heading'},{value:'true',label:'Yes'}]})+
    field('Field accent colour','form.'+section.id+'.inputPrimaryColor',attrs.inputPrimaryColor||'',{type:'color',help:'Borders and focus rings on the form fields.'})
  );
}

var renderContentEditorBeforeV15=renderContentEditor;
renderContentEditor=function(section){
  return renderContentEditorBeforeV15(section)+v15FormPanel(section);
};

var updateBindingBeforeV15=updateBinding;
updateBinding=function(path,value,input){
  var match=/^form\.([^.]+)\.([a-zA-Z]+)$/.exec(String(path||''));
  if(!match)return updateBindingBeforeV15(path,value,input);
  var section=v6Section(match[1]),attrs=section?v15FormAttrs(section):null;
  if(!attrs)return;
  inputCheckpoint();
  var key=match[2];
  // The id is a number in the shortcode and a string in the block attribute;
  // WordPress accepts either, and keeping the digits verbatim means a pasted
  // "12" does not become 12 and then "12" again on the way out.
  if(key==='title')attrs.title=v2Bool(value);
  else if(key==='formId')attrs.formId=String(value).replace(/[^0-9]/g,'');
  else attrs[key]=value;
  queueSave();
  v12QueuePaint(section);
};

/*
 * The slot names the form it will submit to.
 *
 * Without this the control would be invisible in the preview — a field you can
 * change with nothing to show for it, which is the same as a field that does
 * not work.
 */
var renderNodeBeforeV15=renderNode;
renderNode=function(node,ctx){
  var html=renderNodeBeforeV15(node,ctx);
  if(!node||node.component!=='gravityforms/form')return html;
  var id=String((node.attributes||{}).formId||'').trim();
  return html.replace('<b>Production form slot</b>',
    '<b>'+esc(id?'Form '+id:'No form chosen')+'</b>');
};

/* ================================================================== *
 * v14 — The catalogue agrees with the patterns it describes
 *
 * Each pattern ships a description of itself: `counts` of what it repeats,
 * `flags` for what it can do, a one-line `look`, and the component registry the
 * export validates against. All four had drifted away from the trees, and none
 * of it is cosmetic — `v8Score` reads `flags` and `counts` to choose which
 * pattern a concept gets, and `normalizeExportNode` uses the registry to decide
 * which attributes are real.
 *
 * Measured before this layer existed: `flags.media` contradicted the tree on 92
 * patterns, `counts` on 101, and ten `look` strings named a number the pattern
 * does not contain. The default hero declared itself photograph-free while
 * carrying a background image, so every concept that asked for dominant imagery
 * scored it *down*.
 *
 * The fix is to stop shipping the description and derive it, at boot, from the
 * tree that will actually be rendered. Drift then cannot come back: there is one
 * source of truth and it is the pattern itself.
 * ================================================================== */

/** Every node of a pattern tree, in document order. */
function v14Nodes(node,out){
  out=out||[];
  if(!node)return out;
  out.push(node);
  var children=node.children||[];
  for(var i=0;i<children.length;i++)v14Nodes(children[i],out);
  return out;
}

/*
 * Components that put a picture on the page whether or not the pattern file
 * happened to carry one. A banner always renders a background — the renderer
 * falls back to the section's own choice — and the three media blocks exist to
 * hold an image. This is what "carries photography" has to mean, because it is
 * what the visitor sees.
 */
var V14_MEDIA_COMPONENTS=['ds-blocks/dst-banner','ds-blocks/dst-banner-slider','ds-blocks/dst-banner-slide',
  'ds-blocks/c-media','ds-blocks/l-content-2','ds-blocks/marquee'];
var V14_MEDIA_ATTRIBUTES=['backgroundImage','media','images','video'];

function v14Filled(value){
  if(!value)return false;
  if(Array.isArray(value))return value.length>0;
  if(typeof value==='object')return Object.keys(value).length>0;
  return true;
}

/** What a pattern repeats, counted off its own tree. */
function v14Counts(nodes){
  var counts={cards:0,listItems:0,accordionItems:0,tabs:0,columns:0};
  for(var i=0;i<nodes.length;i++){
    switch(nodes[i].component){
      case 'ds-blocks/c-card-item':counts.cards++;break;
      case 'ds-blocks/c-list-item':counts.listItems++;break;
      case 'ds-blocks/c-accordion-item':case 'ds-blocks/dst-hacc-item':counts.accordionItems++;break;
      case 'ds-blocks/ds-tab':counts.tabs++;break;
      case 'ds-blocks/ds-column':counts.columns++;break;
    }
  }
  return counts;
}

/** What a pattern can do, read off its own tree. */
function v14Flags(nodes){
  var components={},filled=false,i;
  for(i=0;i<nodes.length;i++){
    components[nodes[i].component]=true;
    var attributes=nodes[i].attributes||{};
    for(var k=0;k<V14_MEDIA_ATTRIBUTES.length;k++){
      if(v14Filled(attributes[V14_MEDIA_ATTRIBUTES[k]]))filled=true;
    }
  }
  var carries=false;
  for(i=0;i<V14_MEDIA_COMPONENTS.length;i++)if(components[V14_MEDIA_COMPONENTS[i]])carries=true;
  return {
    form:!!components['gravityforms/form'],
    slider:!!(components['ds-blocks/dst-banner-slider']||components['ds-blocks/marquee']),
    tabs:!!components['ds-blocks/ds-tabs'],
    accordion:!!(components['ds-blocks/c-accordion']||components['ds-blocks/dst-hacc']),
    cards:!!components['ds-blocks/c-cards'],
    media:!!(carries||filled),
    // Separate from `media`, and the more selective of the two: the *section's
    // own ground* is a photograph. A card grid carries pictures; a photo-backed
    // banner is made of one. Scoring needs both, or "dominant imagery" cannot
    // tell a hero from a list of thumbnails.
    mediaLed:!!components['ds-blocks/dst-banner']||!!components['ds-blocks/dst-banner-slider']
  };
}

/** A `look` string whose numbers match the tree it describes. */
function v14Look(look,counts){
  var byWord={card:counts.cards,cards:counts.cards,
    item:counts.listItems,items:counts.listItems,
    column:counts.columns,columns:counts.columns,
    tab:counts.tabs,tabs:counts.tabs};
  return String(look||'').replace(/(\d+)(\s+)(cards?|items?|columns?|tabs?)/g,function(all,number,gap,word){
    var actual=byWord[word];
    if(!actual)return all;
    // The word has to follow the number: "5 cards" reading 3 is the bug, but
    // "10 cards" on a pattern with no cards at all is a different sentence and
    // is left alone rather than rewritten into nonsense.
    return actual+gap+(actual===1?word.replace(/s$/,''):(/s$/.test(word)?word:word+'s'));
  });
}

/**
 * Attributes the patterns use that the captured registry does not list.
 *
 * The export deletes any attribute the registry does not know, which is right —
 * it is the only thing stopping a builder-internal key reaching WordPress. But
 * the registry is a snapshot, and where it had fallen behind the theme it was
 * deleting real attributes: both slider controls, a card overlay strength, and
 * `c-heading.description`, which is *copy*. Every entry below was read out of
 * the registered patterns, so each is a value the theme already writes.
 */
var V14_REGISTRY_GAPS={
  'ds-blocks/c-heading':[
    {name:'showButtons',type:'boolean',default:true},
    {name:'showText',type:'boolean',default:true},
    {name:'description',type:'string',default:''},
    {name:'title_styles',type:'object',default:{}}
  ],
  'ds-blocks/c-cards':[
    {name:'mediaOverlayOpacity',type:'number',default:.5},
    {name:'enableLightSlider',type:'boolean',default:false},
    {name:'lightSliderSettings',type:'object',default:{}}
  ],
  'ds-blocks/c-list':[
    {name:'mediaOverlayOpacity',type:'number',default:.5}
  ],
  'ds-blocks/c-btn':[
    {name:'btnVariant',type:'string',default:''}
  ],
  'ds-blocks/dst-banner-slider':[
    {name:'lightSliderSettings',type:'object',default:{}}
  ],
  'ds-blocks/dst-banner':[
    {name:'decorations',type:'array',default:[]}
  ]
};

function v14CompleteRegistry(){
  var added=0;
  Object.keys(V14_REGISTRY_GAPS).forEach(function(component){
    var entry=DATA.registry[component];
    if(!entry)return;
    entry.attributes=Array.isArray(entry.attributes)?entry.attributes:[];
    var known={};
    entry.attributes.forEach(function(attribute){known[attribute.name]=true});
    V14_REGISTRY_GAPS[component].forEach(function(gap){
      if(known[gap.name])return;
      entry.attributes.push({name:gap.name,type:gap.type,enum:null,default:gap.default,hasDefault:true});
      added++;
    });
  });
  return added;
}

/*
 * The staging host, repaired.
 *
 * The ingested library points its media at `dst.dsstaging1.local`. `.local` is
 * reserved for mDNS, so `download_url()` cannot fetch it and
 * `wp_http_validate_url()` will not pass it — the importer records "could not
 * sideload" and leaves a dead URL in the page. The pattern files themselves name
 * the real host, so this puts it back.
 */
var V14_HOST=/\bdst(-dev)?\.dsstaging1\.local\b/g;
function v14RepairHost(value){
  if(typeof value==='string')return V14_HOST.test(value)?value.replace(V14_HOST,'dst.dsstaging1.com'):value;
  if(Array.isArray(value)){for(var i=0;i<value.length;i++)value[i]=v14RepairHost(value[i]);return value}
  if(value&&typeof value==='object'){
    var keys=Object.keys(value);
    for(var k=0;k<keys.length;k++)value[keys[k]]=v14RepairHost(value[keys[k]]);
    return value;
  }
  return value;
}

/** Re-derives every pattern's self-description from its own tree. */
function v14NormalizeCatalog(){
  var report={patterns:0,counts:0,flags:0,looks:0,hosts:0,registry:v14CompleteRegistry()};
  DATA.patterns.forEach(function(pattern){
    report.patterns++;
    var before=JSON.stringify(pattern.tree);
    v14RepairHost(pattern.tree);
    if(JSON.stringify(pattern.tree)!==before)report.hosts++;

    var nodes=v14Nodes(pattern.tree),counts=v14Counts(nodes),flags=v14Flags(nodes);
    if(JSON.stringify(pattern.counts)!==JSON.stringify(counts)){pattern.counts=counts;report.counts++}
    else pattern.counts=counts;
    var merged=Object.assign({},pattern.flags||{},flags);
    if(JSON.stringify(pattern.flags)!==JSON.stringify(merged)){pattern.flags=merged;report.flags++}
    else pattern.flags=merged;

    var look=v14Look(pattern.look,counts);
    if(look!==pattern.look){pattern.look=look;report.looks++}
    // The scoring profile is cached off `look`; a corrected line must not be
    // read through a cache built from the wrong one.
    if(pattern.__sbsProfile!==undefined){try{delete pattern.__sbsProfile}catch(error){/* frozen is fine */}}

    // Every pattern claims a source. Five of them are not in the registered
    // library, and an export that says "attached-skill-library" for a pattern
    // nobody can point at is a provenance claim the builder cannot back.
    if(V14_UNREGISTERED[pattern.id])pattern.provenance='builder-placeholder';
  });
  DATA.media=v14RepairHost(DATA.media);
  return report;
}

/*
 * Patterns the builder ships that are not in `patternsSBS/`. Kept, because the
 * families they fill would otherwise have gaps, but labelled — and the logo
 * family's default is moved to a pattern that is genuinely in the library.
 */
var V14_UNREGISTERED={'sbs-logo-p1-v1':true,'sbs-logo-p2-v1':true,'sbs-logo-p3-v1':true,
  'sbs-cards-p1002-v1':true,'sbs-cards-p1003-v1':true};

function v14RepairDefaults(){
  var changed=[];
  Object.keys(DATA.defaultPatternByFamily).forEach(function(family){
    var id=DATA.defaultPatternByFamily[family];
    if(!V14_UNREGISTERED[id])return;
    var replacement=DATA.patterns.filter(function(pattern){
      return pattern.family===family&&!V14_UNREGISTERED[pattern.id];
    })[0];
    if(!replacement)return;
    DATA.defaultPatternByFamily[family]=replacement.id;
    changed.push(family+': '+id+' -> '+replacement.id);
  });
  return changed;
}

var v14Report=v14NormalizeCatalog();
v14Report.defaults=v14RepairDefaults();

/*
 * The imagery signal, now that the flag is truthful.
 *
 * `flags.media` was false on 92 patterns that carry pictures, so correcting it
 * would otherwise have handed the same "carries photography" bonus to 119 of
 * 154 patterns and flattened the very distinction the dial exists to make.
 * `mediaLed` is the sharper half: the section's own ground is a photograph. A
 * concept asking for dominant imagery now prefers those, and still prefers a
 * card grid with pictures over a pattern with none.
 */
var v8ScoreBeforeV14=v8Score;
v8Score=function(pattern,context){
  var result=v8ScoreBeforeV14(pattern,context),
    imagery=Number(context.design.imagery),
    bonus=(pattern.flags||{}).mediaLed?Math.round((imagery-50)/10):0;
  if(!bonus)return result;
  result.score+=bonus;
  result.why.push((bonus>0?'+':'')+bonus+' the band itself is a photograph');
  return result;
};

/* ================================================================== *
 * v13 — The export writes media the way the patterns write it
 *
 * A page imported into WordPress arrived with its pictures missing, and the
 * reason was not the patterns. All 169 registered patterns agree on how DST
 * stores a picture, and the export had drifted to a shape of its own:
 *
 *   every pattern   c-media.media = {lazyLoad, primaryType, videoExternal,
 *                                    imagePrimary:{id,url,alt,mimeType,
 *                                    mediaType,size},
 *                                    style:{desktop:{mediaRatio,focalPoint},
 *                                           mobile:{…}, borderRadius}}
 *   the export      c-media.media = {src, alt, ratioDesktop:'16/9'}
 *
 *   every pattern   backgroundImage:[{id, desktop:{media:{id,url,mime,type},
 *                                     fixed,focal,size,width}, mobile:{…},
 *                                     lazy, hideMobile, posterImage,
 *                                     fetchPriority, overlay, overlayEnabled,
 *                                     overlayOpacity}]
 *   the export      backgroundImage:[{src, desktop:{size,focal}, …}]
 *
 * A block handed an object it has no reader for renders nothing, which is
 * exactly what "so many things missing" looks like. So this layer converts, at
 * the export boundary, from whatever the builder holds internally into the
 * shape the theme reads — for backgrounds, for the three media blocks, for card
 * media and clips, and for the marquee rail.
 *
 * Two details that decide whether an import is usable rather than merely
 * plausible:
 *
 *   * Every media object keeps an `id` key, even at `0`. The importer sideloads
 *     a URL and writes the new attachment id back only into a key that already
 *     exists — `array_key_exists( 'id', $value )` — so without the key the page
 *     never learns which attachment it got.
 *   * `mime`/`mimeType` is filled in from the file extension. DST decides
 *     between an `<img>` and a `<video>` on the type, and an empty type on a
 *     `.mp4` is a still image that never plays.
 * ================================================================== */

/** `16/9` is the builder's way of writing DST's `16x9`. */
function v13Ratio(value){
  var text=String(value||'').trim();
  if(!text)return '';
  if(/^\d+x\d+$/.test(text))return text;
  var parts=text.split(/[\/:x]/);
  if(parts.length!==2)return '';
  var w=parseFloat(parts[0]),h=parseFloat(parts[1]);
  return Number.isFinite(w)&&Number.isFinite(h)&&w&&h?w+'x'+h:'';
}

var V13_MIME={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',avif:'image/avif',svg:'image/svg+xml',
  mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',m4v:'video/x-m4v',ogv:'video/ogg'};

/**
 * The media type, from the extension when nothing else says.
 *
 * A remote URL with a query string is the common case — a stock photo service
 * hands back `…/photo.jpeg?auto=compress&w=1600` — so the query is dropped
 * before the extension is read.
 */
function v13Mime(src,video){
  var path=String(src||'').split(/[?#]/)[0],match=path.match(/\.([a-z0-9]+)$/i);
  var known=match?V13_MIME[match[1].toLowerCase()]:'';
  if(known)return known;
  return video?'video/mp4':'image/jpeg';
}

function v13Focal(value,fallbackX,fallbackY){
  var focal=value&&typeof value==='object'?value:{},
    x=Number(focal.x),y=Number(focal.y);
  return {x:Number.isFinite(x)?x:fallbackX,y:Number.isFinite(y)?y:fallbackY};
}

/**
 * Everything the builder knows about one picture, read out of any of the shapes
 * it stores them in: its own flat `{src,alt}`, a DST attachment, a DST media
 * block or a DST background layer.
 */
function v13Read(raw){
  if(!raw)return null;
  var media=v2MediaObject(raw);
  if(!media||!media.src)return null;
  var deep=raw&&typeof raw==='object'?raw:{},
    inner=deep.media||deep.imagePrimary||(deep.desktop&&deep.desktop.media)||{},
    video=media.kind==='video'||isVideoMedia(raw)||isVideoMedia(inner);
  return {
    src:media.src,
    alt:media.alt||'Editorial image',
    title:inner.title||media.caption||media.alt||'',
    id:Number(deep.id||inner.id||0)||0,
    video:video,
    mime:inner.mime||inner.mimeType||media.mime||v13Mime(media.src,video),
    poster:media.poster||deep.posterImage||'',
    source:media.source||deep.source||'',
    intent:media.intent||deep.intent||(video?'editorial-video':'editorial-photo'),
    ratioDesktop:v13Ratio(media.ratioDesktop),
    ratioMobile:v13Ratio(media.ratioMobile),
    fitDesktop:media.fitDesktop||'',
    fitMobile:media.fitMobile||'',
    focalDesktop:v13Focal((deep.desktop&&deep.desktop.focal)||(deep.style&&deep.style.desktop&&deep.style.desktop.focalPoint),.5,.5),
    focalMobile:v13Focal((deep.mobile&&deep.mobile.focal)||(deep.style&&deep.style.mobile&&deep.style.mobile.focalPoint),.5,.5),
    hideMobile:!!(media.hideMobile||deep.hideMobile)
  };
}

/** A WordPress attachment object — what `c-card-item.media` holds. */
function v13Attachment(read){
  return {id:read.id,url:read.src,alt:read.alt,mimeType:read.mime,
    mediaType:read.video?'video':'image',size:'full'};
}

/** The `media` attribute of `c-media`, `l-content-2` and `c-accordion`. */
function v13MediaBlock(read,existing){
  var previous=existing&&typeof existing==='object'?existing:{},
    style=previous.style&&typeof previous.style==='object'?previous.style:{},
    desktop={focalPoint:read.focalDesktop},
    mobile={focalPoint:read.focalMobile};
  if(read.ratioDesktop)desktop.mediaRatio=read.ratioDesktop;
  if(read.fitDesktop)desktop.mediaFit=read.fitDesktop;
  if(read.ratioMobile||read.ratioDesktop)mobile.mediaRatio=read.ratioMobile||read.ratioDesktop;
  if(read.fitMobile||read.fitDesktop)mobile.mediaFit=read.fitMobile||read.fitDesktop;
  var out={
    lazyLoad:previous.lazyLoad!==false,
    primaryType:read.video?'video':'image',
    videoExternal:previous.videoExternal&&typeof previous.videoExternal==='object'?previous.videoExternal:{html:''},
    imagePrimary:v13Attachment(read),
    style:{desktop:desktop,mobile:mobile,borderRadius:style.borderRadius||'default'}
  };
  if(read.video)out.videoLocal={id:read.id,url:read.src};
  // A clip that has not buffered must not be a hole in the page.
  if(read.video&&read.poster)out.posterImage=read.poster;
  return out;
}

/** One side of a DST background layer. */
function v13BackgroundSide(read,focal,previous){
  var side=previous&&typeof previous==='object'?previous:{};
  return {
    fixed:!!side.fixed,
    focal:focal,
    size:side.size||'cover',
    width:side.width||'auto',
    media:{id:read.id,title:read.title,url:read.src,alt:read.alt,
      mime:read.mime,type:read.video?'video':'image'}
  };
}

/**
 * A background layer, in the shape all 31 photo-backed patterns use.
 *
 * The per-layer overlay is carried too. The block-level `backgroundOverlay*`
 * attributes are a separate control in DST, and a layer that dropped its own
 * overlay lost a scrim the pattern author put there on purpose.
 */
function v13BackgroundLayer(raw,id,index){
  var read=v13Read(raw);
  if(!read)return null;
  var deep=raw&&typeof raw==='object'?raw:{};
  var layer={
    id:deep.id&&typeof deep.id==='string'?deep.id:(id+'-layer-'+(index+1)),
    desktop:v13BackgroundSide(read,read.focalDesktop,deep.desktop),
    mobile:v13BackgroundSide(read,read.focalMobile,deep.mobile),
    lazy:deep.lazy!==false,
    hideMobile:read.hideMobile,
    posterImage:read.poster||deep.posterImage||'',
    fetchPriority:deep.fetchPriority||'none',
    overlayEnabled:!!deep.overlayEnabled,
    overlay:deep.overlay||'',
    overlayOpacity:Number.isFinite(Number(deep.overlayOpacity))?Number(deep.overlayOpacity):.5
  };
  // Kept alongside the DST shape rather than instead of it: the preview, the
  // audit and the concept round-trip all read `src`, and dropping it here would
  // break re-importing a page the builder itself exported.
  layer.src=read.src;
  layer.alt=read.alt;
  if(read.source)layer.source=read.source;
  if(read.intent)layer.intent=read.intent;
  // `kind` and `mime` at the layer root are how a clip was announced before the
  // per-breakpoint descriptor existed, and the preview and the importer both
  // still read them. Adding the DST shape is not a reason to drop them.
  if(read.video){layer.kind='video';layer.mime=read.mime;layer.mediaType='video'}
  return layer;
}

function v13BackgroundLayers(value,id){
  var raw=Array.isArray(value)?value:(value&&typeof value==='object'?[value]:[]);
  var out=[];
  for(var i=0;i<raw.length;i++){
    var layer=v13BackgroundLayer(raw[i],id||'media',i);
    if(layer)out.push(layer);
  }
  return out;
}

var V13_MEDIA_BLOCKS=['ds-blocks/c-media','ds-blocks/l-content-2','ds-blocks/c-accordion'];
var V13_BACKGROUND_BLOCKS=['ds-blocks/dst-banner','ds-blocks/dst-wrapper','ds-blocks/ds-columns','ds-blocks/c-cards','ds-blocks/c-list'];

/**
 * The export node normalizer, with media rewritten into the theme's own shape.
 *
 * Reassigning the binding means the base's own recursive call lands here too,
 * so every depth is converted without walking the tree a second time.
 */
var normalizeExportNodeBeforeV13=normalizeExportNode;
normalizeExportNode=function(input,ctx){
  var node=normalizeExportNodeBeforeV13(input,ctx),attrs=node.attributes||{};
  var section=ctx&&ctx.section;

  if(V13_BACKGROUND_BLOCKS.indexOf(node.component)>=0&&attrs.backgroundImage){
    var layers=v13BackgroundLayers(attrs.backgroundImage,node.id);
    if(layers.length)attrs.backgroundImage=layers;
    else delete attrs.backgroundImage;
  }

  if(V13_MEDIA_BLOCKS.indexOf(node.component)>=0){
    // A media block whose slot was never filled still has to carry a picture:
    // the preview renders the section's own choice there, and a preview that
    // shows a photograph the export omits is the disagreement this fixes.
    var read=v13Read(attrs.media)||(section?v13Read(mediaChoice(section,0)):null);
    if(read)attrs.media=v13MediaBlock(read,attrs.media);
  }

  if(node.component==='ds-blocks/c-card-item'){
    var card=v13Read(attrs.media);
    if(card){
      attrs.media=v13Attachment(card);
      if(card.video)attrs.video={id:card.id,url:card.src};
    }
    var clip=v13Read(attrs.video);
    if(clip&&!card)attrs.video={id:clip.id,url:clip.src};
  }

  if(node.component==='ds-blocks/c-accordion-item'){
    var item=v13Read(attrs.media);
    if(item)attrs.media=v13Attachment(item);
  }

  if(node.component==='ds-blocks/marquee'&&Array.isArray(attrs.images)){
    attrs.images=attrs.images.map(function(entry,index){
      var instance=(entry&&entry.instanceId)||(node.id+'-logo-'+(index+1));
      var logo=v13Read(entry);
      if(!logo){
        // A placeholder mark has no file, and an image block with no `url` is an
        // empty slot in WordPress. The drawing itself becomes the file — inline
        // SVG as a data URI, which the importer leaves alone because it only
        // sideloads `http(s)`, and which the browser renders directly.
        var svg=entry&&typeof entry.svg==='string'?entry.svg:'';
        if(!svg)return entry;
        return {id:0,url:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),
          alt:(entry&&entry.alt)||'Client logo placeholder',mimeType:'image/svg+xml',
          mediaType:'image',size:'full',caption:(entry&&entry.caption)||'',instanceId:instance};
      }
      var out=v13Attachment(logo);
      out.caption=(entry&&entry.caption)||logo.title||'';
      out.instanceId=instance;
      return out;
    });
  }

  return node;
};

/* ================================================================== *
 * v12 — Editing a module never moves the preview
 *
 * Every property in the module editor queued a full rebuild, and a rebuilt
 * `srcdoc` is a new document: it opens at scroll 0 and the restore then walks
 * it back down. Somebody who has just chosen "Space above: Normal" is looking
 * at the band they are spacing, and what they get is the page leaving and
 * gliding back, with the band they were watching now somewhere else.
 *
 * The media drop already had this fixed by swapping the one changed module in
 * place, and nothing about that is specific to a picture. A background, a
 * content width, an arrival effect, an overlay, a headline, a card's copy, an
 * item added to a list — each changes exactly one module, and `siteCss` is
 * derived from the design dials rather than from any section, so no
 * document-level rule goes stale when one band is replaced.
 *
 * Two things this layer has to get right:
 *
 *   1. The queued rebuild is cancelled when the change lands, not when the
 *      repaint runs. A rebuild firing in between would move the page anyway.
 *   2. A dragged slider fires `input` per pixel. Repainting per pixel would
 *      render one module a hundred times for a single gesture, so repaints are
 *      coalesced to one per frame — the debounce the rebuild used to provide.
 * ================================================================== */

/** The module a bound path addresses, or null when the path addresses none. */
function v12PathSection(path){
  var match=/^(?:setting|effect|decoration|section|fidelity)\.([^.]+)\./.exec(String(path||''));
  return match?v6Section(match[1]):null;
}

var v12PaintFrame=0,v12PaintIds={};
// Counted, not just done: a repaint that silently degraded into a rebuild is
// the failure mode this layer exists to prevent, and a test asserting only
// "the change landed" cannot tell the two apart.
var v12Painted=0,v12Rebuilt=0;

/**
 * Repaints modules in place instead of rebuilding, at most once per frame.
 *
 * A module that cannot be patched — a torn-down frame, a module no longer in
 * the document — falls back to the rebuild, the one case where moving the page
 * beats showing a stale one.
 */
function v12QueuePaint(section){
  if(!section)return;
  v12PaintIds[section.id]=true;
  clearTimeout(previewTimer);
  previewTimer=null;
  if(v12PaintFrame)return;
  v12PaintFrame=requestAnimationFrame(function(){
    v12PaintFrame=0;
    var ids=Object.keys(v12PaintIds),missed=false;
    v12PaintIds={};
    ids.forEach(function(id){
      var target=v6Section(id);
      if(!target)return;
      if(v11PaintInPlace(target))v12Painted+=1;else missed=true;
    });
    if(missed){v12Rebuilt+=1;queuePreview()}
  });
}

var updateBindingBeforeV12=updateBinding;
updateBinding=function(path,value,input){
  // Resolved before the call, because a layer below may null the slice the path
  // points into — clearing a decorative motif drops `section.decoration`.
  var section=v12PathSection(path),result=updateBindingBeforeV12(path,value,input);
  if(section)v12QueuePaint(section);
  return result;
};

/*
 * The fields that never reach `updateBinding` — a headline, a card's copy, a
 * list of bullet points, a slot's own media fields — are read straight off the
 * event by the listeners that own them. All of them live inside the module
 * editor, and everything inside the module editor belongs to the selected
 * module, so one listener covers the lot.
 *
 * Bubble phase on `document`, which is after every `#editorInner` listener has
 * run: the only point at which the change has actually been applied. A field
 * that also went through `updateBinding` is queued twice and painted once —
 * the queue is keyed by module id.
 */
function v12EditorPaint(event){
  var target=event.target;
  if(!target||!target.closest||!target.closest('#editorInner [data-module-editor]'))return;
  v12QueuePaint(currentSection());
}
document.addEventListener('input',v12EditorPaint);
document.addEventListener('change',v12EditorPaint);

/*
 * Adding or removing a repeated item goes through `mutate`, which re-renders
 * the editor pane — so by the time a bubble listener ran, the button that was
 * clicked has been detached from the document and can no longer be asked which
 * panel it was in. The module is therefore recorded in the capture phase,
 * before the pane is rebuilt, and painted on the next frame: well inside the
 * 110ms the rebuild is waiting on.
 */
var V12_ITEM_CONTROLS='[data-add-item],[data-remove-item],[data-add-button],[data-remove-button]';
document.addEventListener('click',function(event){
  var target=event.target;
  if(!target||!target.closest)return;
  if(!target.closest(V12_ITEM_CONTROLS)||!target.closest('#editorInner [data-module-editor]'))return;
  var section=currentSection();
  if(!section)return;
  requestAnimationFrame(function(){v12QueuePaint(v6Section(section.id))});
},true);

v2EnsureProject(state.project);state.project.sections.forEach(function(s){ensureSectionSettings(s);syncSectionNode(s)});window.__SBS_TEST_API={version:SBS_BUILDER_VERSION,previewSwitcher:{step:v6Step,pool:v6PatternPool,hoverId:function(){return v6HoverId},show:v6Show,hide:v6Hide,geometry:v6Geometry},patternChoice:function(family,index){return v8RankPatterns(family,{index:index||0}).slice(0,8).map(function(entry){return {id:entry.pattern.id,score:entry.score,why:entry.why}})},pickPattern:function(family,index){return (v8PickPattern(family,index||0)||{}).id||''},briefDirectives:function(){return briefDirectives(state.project.brief)},ensureProject:v2EnsureProject,buildTheme:function(p,options){return buildTheme(p||state.project,options||{})},buildSiteDocument:function(p,options){return buildSiteDocument(p||state.project,options||{})},buildPageExport:function(p){return buildPageExport(p||state.project)},buildNavigationExport:function(p){return buildNavigationExport(p||state.project)},buildFooterExport:function(p){return buildFooterExport(p||state.project)},buildGlobalsExport:function(p){return buildGlobalsExport(p||state.project)},buildCompleteExport:function(p){return buildExport(p||state.project)},auditDocument:v2AuditDocument,createSection:createSection,patternIds:DATA.patterns.map(function(p){return p.id}),patterns:DATA.patterns.map(function(p){return {id:p.id,family:p.family}}),flowIds:FLOW_CATALOG.map(function(f){return f.id}),flowCatalog:FLOW_CATALOG,allFlows:function(p){return allFlows(p||state.project)},design:{ensure:v3EnsureDesign,dialTokens:function(p){return dialTokens((p||state.project).design)},dialLevels:function(p){return dialLevels((p||state.project).design)},dialCss:function(p){return dialCss((p||state.project).design)},buttonStyleCss:buttonStyleCss,presets:DIAL_PRESETS,dialKeys:DIAL_KEYS,buttonStyles:BUTTON_STYLES},brain:{applyContentDraft:v3ApplyContentDraft,applyCustomFlow:v3ApplyCustomFlow,sectionFamilies:SECTION_FAMILIES},documents:{accept:BRIEF_DOCUMENT_ACCEPT,kind:briefDocumentKind,supported:isBriefDocument,read:readBriefDocument,readAll:readBriefDocuments,apply:function(files){return v11ReadBriefFiles(files)},attached:v17Attachments,detach:v17DetachDocument,chips:v17DocumentChips,source:function(){return briefBrainFeature.briefSourceText(state.project)}},updateBinding:function(path,value,input){return updateBinding(path,value,input)},paint:{painted:function(){return v12Painted},rebuilt:function(){return v12Rebuilt},queue:v12QueuePaint,section:v6RepaintSection},catalog:{report:function(){return v14Report},counts:v14Counts,flags:v14Flags,look:v14Look,nodes:v14Nodes,all:function(){return DATA.patterns},defaults:function(){return DATA.defaultPatternByFamily},unregistered:function(){return V14_UNREGISTERED}},registry:function(){return DATA.registry},mediaLibrary:function(){return DATA.media},exportMedia:{read:v13Read,attachment:v13Attachment,block:v13MediaBlock,layers:v13BackgroundLayers,ratio:v13Ratio,mime:v13Mime},media:{sectionSlots:v5SectionSlots,slots:function(){return v5MediaSlots(state.project)},fillSlots:v5FillSlots,applyPlan:v5ApplyMediaPlan,clearPlan:v5ClearMediaPlan,assetMedia:v5AssetMedia,slotAt:v11SlotAt,markTiles:v11MarkMediaTiles,dragging:function(){return v11Drag}},simple:{mode:v4Mode,setMode:v4SetMode,steps:v4Steps,ensure:function(){return v4EnsureSimple(state.project)},applyConcept:v4ApplyConcept,normalizeConcepts:v4NormalizeConcepts,buildConceptExport:function(p){return v4BuildConceptExport(p||state.project)},importConcept:v4ImportConcept,canLeaveBrief:v4CanLeaveSimpleBrief},styles:{
  families:function(){return STYLE_FAMILIES},
  all:function(){return allStyles()},
  production:function(){return productionStyles()},
  inFamily:stylesInFamily,
  byKey:styleByKey,
  counts:styleCounts,
  active:v10ActiveStyle,
  key:styleKey,
  choose:v10ChooseStyle,
  generate:v10GenerateFromStyle,
  compile:compileStyle,
  recipe:compileSectionRecipe,
  patternWeight:compilePatternWeight,
  variants:VARIANT_RULES
},concepts:{
  list:function(p){return listConcepts(p||state.project)},
  generated:function(p){return listGeneratedConcepts(p||state.project)},
  active:function(p){return getActiveConcept(p||state.project)},
  activeId:function(p){return getActiveConceptId(p||state.project)},
  get:function(id,p){return getConcept(p||state.project,id)},
  open:v4ApplyConcept,
  generate:v4GenerateConceptWorkspaces,
  reset:function(id){return resetConcept(state.project,id)},
  duplicate:function(from,to){return duplicateConcept(state.project,from,to)},
  serialize:function(p){return serializeProject(p||state.project)},
  json:function(p){return projectToJson(p||state.project)},
  isolationDiff:conceptIsolationDiff,
  history:function(){return conceptHistory.report()},
  migration:conceptMigration
},validate:validateProject,
// The selector the rendered-legibility audit measures. Exposed so its negative
// control can sabotage exactly what the instrument looks at, rather than a
// hand-copied list of elements that drifts away from it.
legibilityTextSelector:V9_TEXT_SELECTOR,
state:state};if(typeof briefBrainFeature.initBriefBrain==='function')briefBrainFeature.initBriefBrain(v3BrainContext());v4RenderModeChrome();renderAll();setTimeout(function(){updateDevice();renderPreview()},80);
})();

}
