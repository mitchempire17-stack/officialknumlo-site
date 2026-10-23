// Replace these with the union's real payment details
const CFG={paybill:"000000",till:"000000",airtel:"000000",tkash:"000000",bank:"Bank name, Account name: KNUMLO, A/C 0000000000, Branch",acct:"Your membership number"};
const $=s=>document.querySelector(s);
const CH={
paybill:{n:"M-Pesa",stk:1,help:()=>`<p style="margin:0 0 6px"><b>Pay from your phone:</b></p><ol><li>Open <b>M-Pesa → Lipa na M-Pesa → Paybill</b>.</li><li>Business no. <code>${CFG.paybill}</code></li><li>Account no. <code>${CFG.acct}</code></li><li>Enter the amount, then your M-Pesa PIN.</li></ol><p style="margin:10px 0 0">Or enter your number above and press <b>Send M-Pesa prompt</b> to approve on your phone.</p>`},
airtel:{n:"Airtel Money",stk:1,help:`<ol><li>Enter your Airtel number and press <b>Send Airtel prompt</b>.</li><li>Approve with your Airtel Money PIN.</li></ol><p style="margin:10px 0 0">Or dial <code>*334#</code> → Make Payments → Pay Bill, business name <code>${CFG.airtel}</code>.</p>`},
tkash:{n:"T-Kash",stk:1,help:`<ol><li>Enter your Telkom number and press <b>Send T-Kash prompt</b>.</li><li>Confirm on your phone.</li></ol><p style="margin:10px 0 0">Or dial <code>*460#</code> → Pay Bill, business no. <code>${CFG.tkash}</code>.</p>`},
card:{n:"Visa / Mastercard",help:`<div class="row"><div><label>Card number</label><input inputmode="numeric" placeholder="0000 0000 0000 0000"></div><div><label>Name on card</label><input></div></div><div class="row"><div><label>Expiry</label><input placeholder="MM/YY"></div><div><label>CVV</label><input inputmode="numeric" maxlength="4"></div></div><button class="btn navy" style="margin-top:14px" data-pay>Pay by card</button><p class="note">Card details are handled by the payment gateway, never stored by KNUMLO.</p>`},
bank:{n:"Bank / PesaLink",help:`<p style="margin:0 0 8px">Send via bank transfer, PesaLink, RTGS/EFT, or deposit at any branch or agent:</p><p style="margin:0"><code>${CFG.bank}</code><br>Reference: <code>${CFG.acct}</code></p><label>Bank transaction reference</label><input id="bref" placeholder="e.g. PL2610150001"><button class="btn navy" style="margin-top:14px" data-pay>Submit for confirmation</button>`}
};
document.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>$("#dlg").showModal());$("#close").onclick=()=>$("#dlg").close();$("#dlg").onclick=e=>{if(e.target.id=="dlg")$("#dlg").close()};
const SOC=[["Facebook","<path d='M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z'/>"],["X","<path d='M18.2 2.2h3.3l-7.2 8.3 8.5 11.3h-6.7l-5.2-6.8-6 6.8H1.6l7.7-8.8L1.2 2.2H8l4.7 6.2 5.5-6.2zm-1.2 17.6h1.8L7 4.1H5.1L17 19.8z'/>"],["LinkedIn","<path d='M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.5h4v11H3v-11zm6.5 0h3.8v1.6h.1c.5-1 1.8-2 3.8-2 4 0 4.8 2.6 4.8 6v5.4h-4v-5c0-1.2 0-2.8-1.7-2.8s-2 1.3-2 2.7v5.1h-4v-11z'/>"],["Instagram","<rect x='3' y='3' width='18' height='18' rx='5' fill='none' stroke='currentColor' stroke-width='2'/><circle cx='12' cy='12' r='4' fill='none' stroke='currentColor' stroke-width='2'/><circle cx='17.5' cy='6.5' r='1.2'/>"],["YouTube","<path d='M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3L10 15z'/>"],["WhatsApp","<path d='M12 2a10 10 0 0 0-8.6 15L2 22l5.1-1.3A10 10 0 1 0 12 2zm5.2 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.4.1.6-.1l.8-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.8-.1 1.3z'/>"]];
document.querySelectorAll(".soc").forEach(c=>c.innerHTML=SOC.map(([n,p])=>`<a href="#" aria-label="${n}" title="${n}"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">${p}</svg></a>`).join(""));
$("#news").onsubmit=e=>{e.preventDefault();const v=$("#nem").value.trim(),m=$("#nmsg");
 if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)){m.textContent="Enter a valid email address.";return}
 m.textContent="Thank you. You are subscribed to the KNUMLO newsletter.";$("#nem").value=""};
const bg=$(".burger"),nv=$(".nav");bg.onclick=()=>{const o=nv.classList.toggle("open");bg.setAttribute("aria-expanded",o)};
document.querySelectorAll("#menu a").forEach(a=>a.onclick=()=>{nv.classList.remove("open");bg.setAttribute("aria-expanded","false")});
const CO="Mombasa,Kwale,Kilifi,Tana River,Lamu,Taita-Taveta,Garissa,Wajir,Mandera,Marsabit,Isiolo,Meru,Tharaka-Nithi,Embu,Kitui,Machakos,Makueni,Nyandarua,Nyeri,Kirinyaga,Murang'a,Kiambu,Turkana,West Pokot,Samburu,Trans Nzoia,Uasin Gishu,Elgeyo-Marakwet,Nandi,Baringo,Laikipia,Nakuru,Narok,Kajiado,Kericho,Bomet,Kakamega,Vihiga,Bungoma,Busia,Siaya,Kisumu,Homa Bay,Migori,Kisii,Nyamira,Nairobi".split(",");
const SEC={MOH:"Ministry of Health (MOH)",CPS:"County Public Service (CPS)",PAR:"National referral hospitals",PRI:"Private hospitals (PRI)",MISS:"Mission hospitals (MISS)",UN:"Universities and training institutions (UN)",SC:"Other state corporations and institutions"};
const HOSP={KNH:"Kenyatta National Hospital",MTRH:"Moi Teaching and Referral Hospital",KUTRRH:"Kenyatta University Teaching, Referral and Research Hospital",JOORTH:"Jaramogi Oginga Odinga Teaching and Referral Hospital",MNTRH:"Mathari National Teaching and Referral Hospital"};
const pad=(n,l=3)=>String(n).padStart(l,"0"),esc=t=>String(t).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const nph=p=>{p=p.replace(/\s/g,"");return /^(07|01)\d{8}$/.test(p)||/^\+254[17]\d{8}$/.test(p)?"+254"+p.slice(-9):null};
let DB={seq:2,m:[{id:"12345678",fn:"Amina",ln:"Wanjiru",ph:"+254712345678",em:"amina@example.com",ds:"Medical Laboratory Officer",sec:"CPS",co:47,emp:"",ws:"Pumwani Maternity Hospital",st:"active",no:"KNUMLO/CPS/001/047",ref:"APP-0001"},{id:"23456789",fn:"Brian",ln:"Otieno",ph:"+254722000111",em:"brian@example.com",ds:"Medical Laboratory Technologist",sec:"MISS",co:44,emp:"Migori Mission Hospital",ws:"Laboratory",st:"pending",no:null,ref:"APP-0002"}]};
try{const t=localStorage.getItem("knumlo_db");if(t)DB=JSON.parse(t)}catch(e){}
const store=()=>{try{localStorage.setItem("knumlo_db",JSON.stringify(DB))}catch(e){}};
const emp=m=>m.sec=="PAR"?(HOSP[m.emp]||m.emp):m.sec=="CPS"?CO[m.co-1]+" County Government":m.sec=="MOH"?"Ministry of Health":m.emp;
$("#rsec").innerHTML=Object.entries(SEC).map(([k,v])=>`<option value="${k}">${v}</option>`).join("");
$("#rco").innerHTML=CO.map((c,i)=>`<option value="${i+1}">${c}</option>`).join("");
$("#remS").innerHTML=Object.entries(HOSP).map(([k,v])=>`<option value="${k}">${k} - ${v}</option>`).join("");
$("#rsec").onchange=()=>{const p=$("#rsec").value=="PAR";$("#remS").classList.toggle("hide",!p);$("#remT").classList.toggle("hide",p);$("#remL").textContent=p?"Referral hospital":"Employer"};
document.querySelectorAll("[data-reg]").forEach(b=>b.onclick=e=>{e.preventDefault();$("#rdone").classList.add("hide");$("#regf").classList.remove("hide");$("#regdlg").showModal()});
$("#rclose").onclick=()=>$("#regdlg").close();$("#vclose").onclick=()=>$("#vdlg").close();
$("#regf").onsubmit=e=>{e.preventDefault();const g=i=>$(i).value.trim(),sec=g("#rsec"),id=g("#rid").toUpperCase().replace(/\s/g,""),ph=nph(g("#rph")),em=g("#rem").toLowerCase(),ep=sec=="PAR"?g("#remS"):g("#remT"),er=$("#rerr");
 if(id.length<6){er.textContent="Enter a valid National ID or passport number.";return}
 if(!ph){er.textContent="Enter a valid Kenyan phone number.";return}
 if(!ep){er.textContent="Enter your employer.";return}
 if(DB.m.some(m=>m.id==id||m.em==em||m.ph==ph)){er.textContent="A member or application with this ID, phone or email already exists.";return}
 er.textContent="";const m={id,fn:g("#rf"),ln:g("#rl"),ph,em,ds:g("#rds"),sec,co:+g("#rco"),emp:ep,ws:g("#rws"),st:"pending",no:null,ref:"APP-"+pad(DB.m.length+1,4)};
 DB.m.push(m);store();$("#regf").reset();$("#regf").classList.add("hide");
 $("#rdone").innerHTML=`<h3 style="font-size:1.5rem">Application received</h3><div class="ok-box">Reference <b>${m.ref}</b>. A KNUMLO official will verify your details. Your membership number is issued only after approval.</div>`;$("#rdone").classList.remove("hide")};
function approve(i){const m=DB.m[i];if(m.st!="pending")return;const s=DB.seq++,ec=m.sec=="PAR"?m.emp:(m.sec=="MOH"||m.sec=="SC")?"NG":pad(m.co);m.no=`KNUMLO/${m.sec}/${pad(s)}/${ec}`;m.st="active";store();adm()}
function adm(){const q=$("#aq").value.toLowerCase(),L=DB.m,A=L.filter(x=>x.st=="active");
 $("#ast").innerHTML=[["Total records",L.length],["Active members",A.length],["Pending approval",L.filter(x=>x.st=="pending").length]].map(([a,b])=>`<div class="stat"><b>${b}</b><span>${a}</span></div>`).join("");
 $("#atb").innerHTML=L.map((m,i)=>[m,i]).filter(([m])=>(m.fn+m.ln+m.id+(m.no||"")+CO[m.co-1]).toLowerCase().includes(q)).map(([m,i])=>`<tr><td>${esc(m.fn+" "+m.ln)}<br><small>${esc(m.id)}</small></td><td>${m.sec}</td><td>${CO[m.co-1]}</td><td>${m.st}</td><td>${m.no||"-"}</td><td>${m.st=="pending"?`<button class="tab" data-a="${i}">Approve</button> <button class="tab" data-r="${i}">Reject</button>`:""}</td></tr>`).join("")||'<tr><td colspan="6">No records</td></tr>';
 const c=f=>{const o={};A.forEach(x=>{const k=f(x);o[k]=(o[k]||0)+1});return Object.entries(o).map(([k,v])=>k+": "+v).join(" · ")||"none yet"};
 $("#arep").innerHTML="<b>Sector:</b> "+c(x=>x.sec)+"<br><b>County:</b> "+c(x=>CO[x.co-1])}
$("#atb").onclick=e=>{const a=e.target.dataset.a,r=e.target.dataset.r;if(a!==undefined)approve(+a);if(r!==undefined){DB.m[+r].st="rejected";store();adm()}};
$("#aq").oninput=adm;
$("#aex").onclick=async()=>{const d=window.claude&&await claude.use("downloads");if(!d){alert("Downloads are not available here.");return}
 const q=v=>'"'+String(v??"").replace(/"/g,'""')+'"',rows=[["Membership no","First name","Last name","ID/Passport","Phone","Email","Designation","Sector","Employer","County","Workstation","Status"]].concat(DB.m.map(m=>[m.no,m.fn,m.ln,m.id,m.ph,m.em,m.ds,m.sec,emp(m),CO[m.co-1],m.ws,m.st]));
 d.save({filename:"KNUMLO-register.csv",data:new Blob(["\ufeff"+rows.map(r=>r.map(q).join(",")).join("\n")],{type:"text/csv"})}).catch(()=>{})};
async function dl(m){const d=window.claude&&await claude.use("downloads");if(!d){alert("Downloads are not available here.");return}
 const cv=document.createElement("canvas");cv.width=900;cv.height=520;const x=cv.getContext("2d"),g=x.createLinearGradient(0,0,900,520);g.addColorStop(0,"#234675");g.addColorStop(1,"#12284a");x.fillStyle=g;x.fillRect(0,0,900,520);
 x.fillStyle="#E10F1F";x.fillRect(0,500,900,20);x.drawImage($(".nav img"),36,36,96,96);x.fillStyle="#fff";
 x.font="700 22px Montserrat,sans-serif";x.fillText("KENYA NATIONAL UNION OF",150,76);x.fillText("MEDICAL LABORATORY OFFICERS",150,106);
 x.font="800 40px Montserrat,sans-serif";x.fillText(m.fn+" "+m.ln,36,230);x.font="500 22px Montserrat,sans-serif";x.fillText(m.ds,36,278);x.fillText(emp(m).slice(0,48),36,314);
 x.fillStyle="#E10F1F";x.fillRect(36,350,500,60);x.fillStyle="#fff";x.font="700 26px Montserrat,sans-serif";x.fillText(m.no,52,390);
 x.fillRect(640,170,220,220);const q=$("#qr canvas");if(q)x.drawImage(q,650,180,200,200);
 cv.toBlob(b=>d.save({filename:"KNUMLO-card-"+m.no.split("/")[2]+".png",data:b}).catch(()=>{}))}
function mem(m){CFG.acct=m.no||"(issued after approval)";$("#who").textContent="Welcome, "+m.fn;$("#mid").textContent=m.no?"Membership no. "+m.no:"Application "+m.ref+" (pending approval)";const c=$("#mcard");
 if(m.st!="active"){c.innerHTML=`<div class="ok-box" style="border-color:var(--maroon)"><b>${m.st=="pending"?"Application pending approval.":"Application not approved."}</b> A membership number is issued only after a KNUMLO official approves your application.</div>`;return}
 c.innerHTML=`<div class="mcard"><div><small>KENYA NATIONAL UNION OF MEDICAL LABORATORY OFFICERS</small><h4>${esc(m.fn+" "+m.ln)}</h4><p>${esc(m.ds)}<br>${esc(emp(m))}</p><span class="mno">${m.no}</span></div><div id="qr"></div></div><button class="btn navy" id="cdl">Download card (PNG)</button>
 <div class="row"><div><label for="uws">Workstation</label><input id="uws" value="${esc(m.ws)}"></div><div><label for="uph">Phone</label><input id="uph" value="${esc(m.ph)}"></div></div><button class="btn ghost" id="usv" style="margin-top:12px">Save changes</button><p class="note" id="umsg">Changing your employment details never changes your membership number.</p>`;
 if(window.QRCode)new QRCode($("#qr"),{text:location.href.split("#")[0]+"#v_"+m.no.replace(/\//g,"_"),width:112,height:112});
 $("#cdl").onclick=()=>dl(m);
 $("#usv").onclick=()=>{m.ws=$("#uws").value.trim()||m.ws;const p=nph($("#uph").value);if(p)m.ph=p;store();$("#umsg").textContent="Details updated. Your membership number is unchanged."}}
$("#loginView").onsubmit=e=>{e.preventDefault();const k=$("#mno").value.trim().toUpperCase().replace(/\s/g,""),p=$("#pw").value,er=$("#err");
 if(!k||!p){er.textContent="Enter your details and password.";return}
 if($("#role").value=="staff"){er.textContent="";$("#loginView").classList.add("hide");$("#adm").classList.remove("hide");adm();return}
 const m=DB.m.find(x=>x.id==k||(x.no&&x.no.replace(/\s/g,"")==k));
 if(!m){er.textContent="No record found. Check your details or join KNUMLO first.";return}
 er.textContent="";mem(m);$("#loginView").classList.add("hide");$("#dash").classList.remove("hide");tabs();upd()};
$("#aout").onclick=()=>{$("#adm").classList.add("hide");$("#loginView").classList.remove("hide");$("#pw").value=""};
function ver(){const h=location.hash;if(!h.startsWith("#v_"))return;const no=h.slice(3).replace(/_/g,"/"),m=DB.m.find(x=>x.no==no);
 $("#vres").innerHTML=m&&m.st=="active"?`<div class="ok-box"><b>Valid. Active member.</b><br>${esc(no)}<br>${SEC[m.sec]}</div>`:`<div class="ok-box" style="border-color:var(--maroon)"><b>Not verified.</b> No active membership found for ${esc(no)}.</div>`;if(!$("#vdlg").open)$("#vdlg").showModal()}
if(!window.KNUMLO_API){addEventListener("hashchange",ver);ver()}

let cur="paybill";
function tabs(){
 $("#tabs").innerHTML=`<button class="mp" data-k="paybill" aria-pressed="${cur=="paybill"}"><span>Lipa na M-Pesa Paybill</span><small>Paybill ${CFG.paybill}</small></button>`+Object.entries(CH).filter(([k])=>k!="paybill").map(([k,v])=>`<button class="tab" role="tab" aria-selected="${k==cur}" data-k="${k}">${v.n}</button>`).join("");
 const c=CH[cur];
 $("#panel").innerHTML=(c.stk?`<label for="ph" style="margin-top:0">Phone number</label><input id="ph" type="tel" placeholder="07XX XXX XXX" inputmode="tel"><button class="btn navy" style="margin-top:12px" data-pay>Send ${c.n} prompt</button>`:"")+(typeof c.help=="function"?c.help():c.help);
}
$("#tabs").onclick=e=>{const b=e.target.closest("[data-k]");if(b){cur=b.dataset.k;tabs()}};
$("#panel").onclick=e=>{if(e.target.dataset.pay!==undefined)pay(e.target)};
function pay(btn){
 const a=+$("#amt").value,c=CH[cur];
 if(!(a>=50)){$("#receipt").innerHTML=`<p class="err" role="alert">Enter an amount of at least KES 50.</p>`;return}
 if(c.stk){const p=($("#ph").value||"").replace(/\s/g,"");if(!/^(07|01|\+?2547|\+?2541)\d{7,8}$/.test(p)){$("#receipt").innerHTML=`<p class="err" role="alert">Enter a valid Kenyan phone number, for example 0712 345 678.</p>`;return}}
 btn.disabled=true;btn.textContent="Waiting for confirmation…";
 setTimeout(()=>{
  const ref=(cur=="paybill"?"S":cur=="airtel"?"A":cur=="tkash"?"T":cur=="card"?"C":"B")+Math.random().toString(36).slice(2,10).toUpperCase();
  const d=new Date().toLocaleDateString("en-KE",{day:"numeric",month:"short",year:"numeric"});
  $("#receipt").innerHTML=`<div class="ok-box" role="status"><b>Payment received.</b> KES ${a.toLocaleString()} via ${c.n}. Reference <b>${ref}</b>.</div>`;
  const h=$("#hist");if(h.querySelector("[colspan]"))h.innerHTML="";
  h.insertAdjacentHTML("afterbegin",`<tr><td>${d}</td><td>${c.n}</td><td>${ref}</td><td>KES ${a.toLocaleString()}</td></tr>`);
  paid+=a;bal=Math.max(0,bal-a);upd();tabs();
 },1800);
}
let bal=3000,paid=0;
function upd(){$("#bal").textContent="KES "+bal.toLocaleString();$("#paid").textContent="KES "+paid.toLocaleString();const s=$("#status");s.textContent=bal?"Dues pending":"Up to date";s.className="badge"+(bal?"":" ok")}
$("#out").onclick=()=>{$("#dash").classList.add("hide");$("#loginView").classList.remove("hide");$("#pw").value="";$("#receipt").innerHTML=""};
const API0=window.KNUMLO_API||"",API=API0.replace(/\/$/,"");   // "/" means the API is on the same site
if(API0){
 let TOK=null;
 const api=async(p,o={})=>{const r=await fetch(API+p,{...o,headers:{"Content-Type":"application/json",...(TOK?{Authorization:"Bearer "+TOK}:{})},body:o.body?JSON.stringify(o.body):undefined});let j={};try{j=await r.json()}catch(e){}if(!r.ok)throw new Error(j.error||"Request failed");return j};
 api("/api/config").then(c=>{if(c.paybill)CFG.paybill=c.paybill;if(c.monthlyDues){document.querySelectorAll(".stat b")[1].textContent="KES "+c.monthlyDues.toLocaleString();$("#amt").value=c.monthlyDues}}).catch(()=>{});
 const loadMe=async()=>{const m=await api("/api/me");bal=m.outstanding;paid=m.paidTotal;mem(m);const h=await api("/api/me/payments");
  $("#hist").innerHTML=h.length?h.map(x=>`<tr><td>${esc(x.date)}</td><td>${esc(x.channel.replace(/_/g," "))}</td><td>${esc(x.reference||x.provider_ref||"-")}</td><td>KES ${Number(x.amount).toLocaleString()} (${esc(x.status)})</td></tr>`).join(""):'<tr><td colspan="4" style="color:var(--mute)">No payments yet. Your receipts will appear here.</td></tr>';upd()};
 const mem0=mem;mem=function(m){mem0(m);const b=$("#usv");if(b)b.onclick=async()=>{try{await api("/api/me",{method:"PATCH",body:{workstation:$("#uws").value,phone:$("#uph").value}});$("#umsg").textContent="Details updated. Your membership number is unchanged."}catch(x){$("#umsg").textContent=x.message}}};
 $("#regf").onsubmit=async e=>{e.preventDefault();const g=i=>$(i).value.trim(),sec=g("#rsec"),er=$("#rerr");
  try{const r=await api("/api/register",{method:"POST",body:{firstName:g("#rf"),lastName:g("#rl"),idNumber:g("#rid"),phone:g("#rph"),email:g("#rem"),designation:g("#rds"),kmlttbNo:g("#rkm"),sector:sec,countyId:+g("#rco"),employer:sec=="PAR"?g("#remS"):g("#remT"),workstation:g("#rws")}});
   er.textContent="";$("#regf").reset();$("#regf").classList.add("hide");
   $("#rdone").innerHTML=`<h3 style="font-size:1.5rem">Application received</h3><div class="ok-box">Reference <b>${esc(r.reference)}</b>. A KNUMLO official will verify your details. Your membership number is issued only after approval.</div>`;$("#rdone").classList.remove("hide")}catch(x){er.textContent=x.message}};
 $("#loginView").onsubmit=async e=>{e.preventDefault();const k=$("#mno").value.trim(),p=$("#pw").value,er=$("#err");
  if(!k||!p){er.textContent="Enter your details and password.";return}
  try{
   if($("#role").value=="staff"){TOK=(await api("/api/auth/staff-login",{method:"POST",body:{email:k,password:p}})).token;er.textContent="";$("#loginView").classList.add("hide");$("#adm").classList.remove("hide");adm();return}
   TOK=(await api("/api/auth/login",{method:"POST",body:{login:k,password:p}})).token;await loadMe();
   er.textContent="";$("#loginView").classList.add("hide");$("#dash").classList.remove("hide");tabs();upd()
  }catch(x){er.textContent=x.message}};
 $("#loginView").insertAdjacentHTML("beforeend",'<p class="note"><a href="#" id="frg">First time here, or forgot your password?</a></p>');
 $("#dlg .portal").insertAdjacentHTML("beforeend",'<form id="rstf" class="login hide"><h3 style="font-size:1.5rem">First time or forgot password</h3><label for="rsid">ID number</label><input id="rsid"><label for="rsph">Phone number on record</label><input id="rsph" type="tel"><div class="err" id="rserr" role="alert"></div><button class="btn" style="width:100%;margin-top:6px">Send link by SMS</button></form><form id="setf" class="login hide"><h3 style="font-size:1.5rem">Set your password</h3><label for="np">New password (8+ characters)</label><input id="np" type="password" autocomplete="new-password"><div class="err" id="nperr" role="alert"></div><button class="btn" style="width:100%;margin-top:6px">Save password</button></form>');
 $("#frg").onclick=e=>{e.preventDefault();$("#loginView").classList.add("hide");$("#rstf").classList.remove("hide")};
 $("#rstf").onsubmit=async e=>{e.preventDefault();try{const r=await api("/api/auth/request-reset",{method:"POST",body:{idNumber:$("#rsid").value,phone:$("#rsph").value}});$("#rserr").style.color="inherit";$("#rserr").textContent=r.message}catch(x){$("#rserr").textContent=x.message}};
 let ST=null;const setHash=()=>{const m=/^#set_([0-9a-f]+)$/.exec(location.hash);if(m){ST=m[1];$("#loginView").classList.add("hide");$("#rstf").classList.add("hide");$("#setf").classList.remove("hide");if(!$("#dlg").open)$("#dlg").showModal()}};
 $("#setf").onsubmit=async e=>{e.preventDefault();try{await api("/api/auth/set-password",{method:"POST",body:{token:ST,password:$("#np").value}});$("#nperr").textContent="Password saved. You can now log in.";setTimeout(()=>{$("#setf").classList.add("hide");$("#loginView").classList.remove("hide");history.replaceState(null,"",location.pathname)},1500)}catch(x){$("#nperr").textContent=x.message}};
 addEventListener("hashchange",setHash);setHash();
 pay=async function(btn){const a=+$("#amt").value,c=CH[cur],rc=$("#receipt");
  if(!(a>=50)){rc.innerHTML='<p class="err" role="alert">Enter an amount of at least KES 50.</p>';return}
  if(cur!="paybill"){rc.innerHTML='<p class="note">Online confirmation is available through Lipa na M-Pesa Paybill. Other channels will be added later.</p>';return}
  btn.disabled=true;btn.textContent="Sending prompt...";
  try{const r=await api("/api/payments/stk",{method:"POST",body:{amount:a,phone:$("#ph").value}});rc.innerHTML=`<div class="ok-box" role="status">${esc(r.message)}</div>`;
   for(let i=0;i<30;i++){await new Promise(z=>setTimeout(z,3000));const s=await api("/api/payments/"+r.paymentId);if(s.status!="pending"){rc.innerHTML=s.status=="completed"?`<div class="ok-box" role="status"><b>Payment received.</b> Receipt ${esc(s.receipt_no||"")}.</div>`:`<p class="err" role="alert">Payment ${esc(s.status)}. ${esc(s.notes||"")}</p>`;break}}
   await loadMe()}catch(x){rc.innerHTML=`<p class="err" role="alert">${esc(x.message)}</p>`}
  btn.disabled=false;btn.textContent="Send M-Pesa prompt"};
 adm=async function(){try{const q=$("#aq").value.trim(),[s,l]=await Promise.all([api("/api/admin/stats"),api("/api/admin/members?limit=100&q="+encodeURIComponent(q))]);
  $("#ast").innerHTML=[["Total records",s.total],["Active members",s.active],["Pending approval",s.pending]].map(([a,b])=>`<div class="stat"><b>${b}</b><span>${a}</span></div>`).join("");
  $("#atb").innerHTML=l.rows.map(m=>`<tr><td>${esc(m.fn+" "+m.ln)}<br><small>${esc(m.idn)}</small></td><td>${esc(m.sec||"")}</td><td>${esc(CO[m.co-1]||"-")}</td><td>${esc(m.st)}${m.review?" (review)":""}</td><td>${esc(m.no||"-")}</td><td>${m.st=="pending"?`<button class="tab" data-a="${m.id}">Approve</button> <button class="tab" data-r="${m.id}">Reject</button>`:""}</td></tr>`).join("")||'<tr><td colspan="6">No records</td></tr>';
  const f=o=>Object.entries(o).map(([k,v])=>k+": "+v).join(" · ")||"none yet";
  $("#arep").innerHTML="<b>Sector:</b> "+f(s.bySector)+"<br><b>County:</b> "+f(s.byCounty)+(l.total>100?`<br><small>Showing the first 100 of ${l.total}. Use search to narrow.</small>`:"")}catch(x){$("#atb").innerHTML=`<tr><td colspan="6">${esc(x.message)}</td></tr>`}};
 $("#aq").oninput=()=>{clearTimeout(window._t);window._t=setTimeout(adm,300)};
 $("#atb").onclick=async e=>{const a=e.target.dataset.a,r=e.target.dataset.r;try{if(a)await api(`/api/admin/members/${a}/approve`,{method:"POST"});if(r)await api(`/api/admin/members/${r}/reject`,{method:"POST",body:{}});if(a||r)adm()}catch(x){alert(x.message)}};
 $("#aex").insertAdjacentHTML("afterend",'<button class="btn ghost" id="abk" style="width:100%;margin-top:8px">Approve all verified</button>');
 $("#abk").onclick=async()=>{if(!confirm("Approve every pending applicant that has no review flag? Numbers are issued in registration order."))return;try{const r=await api("/api/admin/approve-bulk",{method:"POST"});alert(r.approved+" members approved.");adm()}catch(x){alert(x.message)}};
 $("#aex").onclick=async()=>{try{const r=await fetch(API+"/api/admin/export.csv",{headers:{Authorization:"Bearer "+TOK}});if(!r.ok)throw new Error("Export failed");const u=URL.createObjectURL(await r.blob()),a=document.createElement("a");a.href=u;a.download="KNUMLO-register.csv";a.click();URL.revokeObjectURL(u)}catch(x){alert(x.message)}};
 $("#news").onsubmit=async e=>{e.preventDefault();const m=$("#nmsg");try{await api("/api/newsletter",{method:"POST",body:{email:$("#nem").value}});m.textContent="Thank you. You are subscribed to the KNUMLO newsletter.";$("#nem").value=""}catch(x){m.textContent=x.message}};
 $("#out").addEventListener("click",()=>{TOK=null});$("#aout").addEventListener("click",()=>{TOK=null});
 const ver2=async()=>{const h=location.hash;if(!h.startsWith("#v_"))return;const t=h.slice(3);let r;try{r=await api("/api/verify/"+encodeURIComponent(t))}catch(x){r={valid:false,number:t.replace(/_/g,"/")}}
  $("#vres").innerHTML=r.valid?`<div class="ok-box"><b>Valid. Active member.</b><br>${esc(r.number)}<br>${esc(r.sector||"")}</div>`:`<div class="ok-box" style="border-color:var(--maroon)"><b>Not verified.</b> No active membership found for ${esc(r.number)}.</div>`;if(!$("#vdlg").open)$("#vdlg").showModal()};
 addEventListener("hashchange",ver2);ver2();
}
