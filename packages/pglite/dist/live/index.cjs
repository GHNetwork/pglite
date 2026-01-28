"use strict";var J=Object.defineProperty;var me=Object.getOwnPropertyDescriptor;var ye=Object.getOwnPropertyNames;var ge=Object.prototype.hasOwnProperty;var re=e=>{throw TypeError(e)};var he=(e,t)=>{for(var n in t)J(e,n,{get:t[n],enumerable:!0})},be=(e,t,n,s)=>{if(t&&typeof t=="object"||typeof t=="function")for(let r of ye(t))!ge.call(e,r)&&r!==n&&J(e,r,{get:()=>t[r],enumerable:!(s=me(t,r))||s.enumerable});return e};var we=e=>be(J({},"__esModule",{value:!0}),e);var Y=(e,t,n)=>t.has(e)||re("Cannot "+n);var l=(e,t,n)=>(Y(e,t,"read from private field"),n?n.call(e):t.get(e)),P=(e,t,n)=>t.has(e)?re("Cannot add the same private member more than once"):t instanceof WeakSet?t.add(e):t.set(e,n),$=(e,t,n,s)=>(Y(e,t,"write to private field"),s?s.call(e,n):t.set(e,n),n),C=(e,t,n)=>(Y(e,t,"access private method"),n);var K=(e,t,n,s)=>({set _(r){$(e,t,r,n)},get _(){return l(e,t,s)}});var ut={};he(ut,{live:()=>lt});module.exports=we(ut);function U(e){let t=e.length;for(let n=e.length-1;n>=0;n--){let s=e.charCodeAt(n);s>127&&s<=2047?t++:s>2047&&s<=65535&&(t+=2),s>=56320&&s<=57343&&n--}return t}var A,T,G,j,k,S,q,F,se,O=class{constructor(t=256){this.size=t;P(this,S);P(this,A);P(this,T,5);P(this,G,!1);P(this,j,new TextEncoder);P(this,k,0);$(this,A,C(this,S,q).call(this,t))}addInt32(t){return C(this,S,F).call(this,4),l(this,A).setInt32(l(this,T),t,l(this,G)),$(this,T,l(this,T)+4),this}addInt16(t){return C(this,S,F).call(this,2),l(this,A).setInt16(l(this,T),t,l(this,G)),$(this,T,l(this,T)+2),this}addCString(t){return t&&this.addString(t),C(this,S,F).call(this,1),l(this,A).setUint8(l(this,T),0),K(this,T)._++,this}addString(t=""){let n=U(t);return C(this,S,F).call(this,n),l(this,j).encodeInto(t,new Uint8Array(l(this,A).buffer,l(this,T))),$(this,T,l(this,T)+n),this}add(t){let n=t instanceof Uint8Array?t.buffer.slice(t.byteOffset,t.byteOffset+t.byteLength):t;return C(this,S,F).call(this,n.byteLength),new Uint8Array(l(this,A).buffer).set(new Uint8Array(n),l(this,T)),$(this,T,l(this,T)+n.byteLength),this}flush(t){let n=C(this,S,se).call(this,t);return $(this,T,5),$(this,A,C(this,S,q).call(this,this.size)),new Uint8Array(n)}};A=new WeakMap,T=new WeakMap,G=new WeakMap,j=new WeakMap,k=new WeakMap,S=new WeakSet,q=function(t){return new DataView(new ArrayBuffer(t))},F=function(t){if(l(this,A).byteLength-l(this,T)<t){let s=l(this,A).buffer,r=s.byteLength+(s.byteLength>>1)+t;$(this,A,C(this,S,q).call(this,r)),new Uint8Array(l(this,A).buffer).set(new Uint8Array(s))}},se=function(t){if(t){l(this,A).setUint8(l(this,k),t);let n=l(this,T)-(l(this,k)+1);l(this,A).setInt32(l(this,k)+1,n,l(this,G))}return l(this,A).buffer.slice(t?0:5,l(this,T))};var h=new O,_e=e=>{h.addInt16(3).addInt16(0);for(let s of Object.keys(e))h.addCString(s).addCString(e[s]);h.addCString("client_encoding").addCString("UTF8");let t=h.addCString("").flush(),n=t.byteLength+4;return new O().addInt32(n).add(t).flush()},Ee=()=>{let e=new DataView(new ArrayBuffer(8));return e.setInt32(0,8,!1),e.setInt32(4,80877103,!1),new Uint8Array(e.buffer)},Ae=e=>h.addCString(e).flush(112),Te=(e,t)=>(h.addCString(e).addInt32(U(t)).addString(t),h.flush(112)),Ie=e=>h.addString(e).flush(112),Se=e=>h.addCString(e).flush(81),Re=[],$e=e=>{let t=e.name??"";t.length>63&&(console.error("Warning! Postgres only supports 63 characters for query names."),console.error("You supplied %s (%s)",t,t.length),console.error("This can cause conflicts and silent errors executing queries"));let n=h.addCString(t).addCString(e.text).addInt16(e.types?.length??0);return e.types?.forEach(s=>n.addInt32(s)),h.flush(80)},W=new O;var Le=(e,t)=>{for(let n=0;n<e.length;n++){let s=t?t(e[n],n):e[n];if(s===null)h.addInt16(0),W.addInt32(-1);else if(s instanceof ArrayBuffer||ArrayBuffer.isView(s)){let r=ArrayBuffer.isView(s)?s.buffer.slice(s.byteOffset,s.byteOffset+s.byteLength):s;h.addInt16(1),W.addInt32(r.byteLength),W.add(r)}else h.addInt16(0),W.addInt32(U(s)),W.addString(s)}},Ce=(e={})=>{let t=e.portal??"",n=e.statement??"",s=e.binary??!1,r=e.values??Re,c=r.length;return h.addCString(t).addCString(n),h.addInt16(c),Le(r,e.valueMapper),h.addInt16(c),h.add(W.flush()),h.addInt16(s?1:0),h.flush(66)},Ne=new Uint8Array([69,0,0,0,9,0,0,0,0,0]),ve=e=>{if(!e||!e.portal&&!e.rows)return Ne;let t=e.portal??"",n=e.rows??0,s=U(t),r=4+s+1+4,c=new DataView(new ArrayBuffer(1+r));return c.setUint8(0,69),c.setInt32(1,r,!1),new TextEncoder().encodeInto(t,new Uint8Array(c.buffer,5)),c.setUint8(s+5,0),c.setUint32(c.byteLength-4,n,!1),new Uint8Array(c.buffer)},Pe=(e,t)=>{let n=new DataView(new ArrayBuffer(16));return n.setInt32(0,16,!1),n.setInt16(4,1234,!1),n.setInt16(6,5678,!1),n.setInt32(8,e,!1),n.setInt32(12,t,!1),new Uint8Array(n.buffer)},Z=(e,t)=>{let n=new O;return n.addCString(t),n.flush(e)},De=h.addCString("P").flush(68),Be=h.addCString("S").flush(68),Me=e=>e.name?Z(68,`${e.type}${e.name??""}`):e.type==="P"?De:Be,Oe=e=>{let t=`${e.type}${e.name??""}`;return Z(67,t)},xe=e=>h.add(e).flush(100),Ue=e=>Z(102,e),H=e=>new Uint8Array([e,0,0,0,4]),Fe=H(72),Ge=H(83),ke=H(88),We=H(99),V={startup:_e,password:Ae,requestSsl:Ee,sendSASLInitialResponseMessage:Te,sendSCRAMClientFinalMessage:Ie,query:Se,parse:$e,bind:Ce,execute:ve,describe:Me,close:Oe,flush:()=>Fe,sync:()=>Ge,end:()=>ke,copyData:xe,copyDone:()=>We,copyFail:Ue,cancel:Pe};var St=new ArrayBuffer(0);var qe=1,je=4,fn=qe+je,pn=new ArrayBuffer(0);var He=globalThis.JSON.parse,Qe=globalThis.JSON.stringify,ae=16,ie=17;var oe=20,ze=21,Xe=23;var Q=25,Je=26;var le=114;var Ye=700,Ke=701;var Ze=1042,et=1043,tt=1082;var nt=1114,ce=1184;var rt=3802;var st={string:{to:Q,from:[Q,et,Ze],serialize:e=>{if(typeof e=="string")return e;if(typeof e=="number")return e.toString();throw new Error("Invalid input for string type")},parse:e=>e},number:{to:0,from:[ze,Xe,Je,Ye,Ke],serialize:e=>e.toString(),parse:e=>+e},bigint:{to:oe,from:[oe],serialize:e=>e.toString(),parse:e=>{let t=BigInt(e);return t<Number.MIN_SAFE_INTEGER||t>Number.MAX_SAFE_INTEGER?t:Number(t)}},json:{to:le,from:[le,rt],serialize:e=>typeof e=="string"?e:Qe(e),parse:e=>He(e)},boolean:{to:ae,from:[ae],serialize:e=>{if(typeof e!="boolean")throw new Error("Invalid input for boolean type");return e?"t":"f"},parse:e=>e==="t"},date:{to:ce,from:[tt,nt,ce],serialize:e=>{if(typeof e=="string")return e;if(typeof e=="number")return new Date(e).toISOString();if(e instanceof Date)return e.toISOString();throw new Error("Invalid input for date type")},parse:e=>new Date(e)},bytea:{to:ie,from:[ie],serialize:e=>{if(!(e instanceof Uint8Array))throw new Error("Invalid input for bytea type");return"\\x"+Array.from(e).map(t=>t.toString(16).padStart(2,"0")).join("")},parse:e=>{let t=e.slice(2);return Uint8Array.from({length:t.length/2},(n,s)=>parseInt(t.substring(s*2,(s+1)*2),16))}}},ue=at(st),An=ue.parsers,Tn=ue.serializers;function at(e){return Object.keys(e).reduce(({parsers:t,serializers:n},s)=>{let{to:r,from:c,serialize:a,parse:b}=e[s];return n[r]=a,n[s]=a,t[s]=b,Array.isArray(c)?c.forEach(y=>{t[y]=b,n[y]=a}):(t[c]=b,n[c]=a),{parsers:t,serializers:n}},{parsers:{},serializers:{}})}function de(e){let t=e.find(n=>n.name==="parameterDescription");return t?t.dataTypeIDs:[]}var Dn=typeof process=="object"&&typeof process.versions=="object"&&typeof process.versions.node=="string";var ee=()=>{if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();let e=new Uint8Array(16);if(globalThis.crypto?.getRandomValues)globalThis.crypto.getRandomValues(e);else for(let n=0;n<e.length;n++)e[n]=Math.floor(Math.random()*256);e[6]=e[6]&15|64,e[8]=e[8]&63|128;let t=[];return e.forEach(n=>{t.push(n.toString(16).padStart(2,"0"))}),t.slice(0,4).join("")+"-"+t.slice(4,6).join("")+"-"+t.slice(6,8).join("")+"-"+t.slice(8,10).join("")+"-"+t.slice(10).join("")};async function te(e,t,n,s){if(!n||n.length===0)return t;s=s??e;let r=[];try{await e.execProtocol(V.parse({text:t}),{syncToFs:!1}),r.push(...(await e.execProtocol(V.describe({type:"S"}),{syncToFs:!1})).messages)}finally{r.push(...(await e.execProtocol(V.sync(),{syncToFs:!1})).messages)}let c=de(r),a=t.replace(/\$([0-9]+)/g,(y,u)=>"%"+u+"L");return(await s.query(`SELECT format($1, ${n.map((y,u)=>`$${u+2}`).join(", ")}) as query`,[a,...n],{paramTypes:[Q,...c]})).rows[0].query}function ne(e){let t,n=!1,s=async()=>{if(!t){n=!1;return}n=!0;let{args:r,resolve:c,reject:a}=t;t=void 0;try{let b=await e(...r);c(b)}catch(b){a(b)}finally{s()}};return async(...r)=>{t&&t.resolve(void 0);let c=new Promise((a,b)=>{t={args:r,resolve:a,reject:b}});return n||s(),c}}var it=5,ot=async(e,t)=>{let n=new Set,s={async query(r,c,a){let b,y,u;if(typeof r!="string"&&(b=r.signal,c=r.params,a=r.callback,y=r.offset,u=r.limit,r=r.query),y===void 0!=(u===void 0))throw new Error("offset and limit must be provided together");let i=y!==void 0&&u!==void 0,I;if(i&&(typeof y!="number"||isNaN(y)||typeof u!="number"||isNaN(u)))throw new Error("offset and limit must be numbers");let w=a?[a]:[],m=ee().replace(/-/g,""),v=!1,R,D,x=async()=>{await e.transaction(async o=>{let d=c&&c.length>0?await te(e,r,c,o):r;await o.exec(`CREATE OR REPLACE TEMP VIEW live_query_${m}_view AS ${d}`);let _=await fe(o,`live_query_${m}_view`);await pe(o,_,n),i?(await o.exec(`
              PREPARE live_query_${m}_get(int, int) AS
              SELECT * FROM live_query_${m}_view
              LIMIT $1 OFFSET $2;
            `),await o.exec(`
              PREPARE live_query_${m}_get_total_count AS
              SELECT COUNT(*) FROM live_query_${m}_view;
            `),I=(await o.query(`EXECUTE live_query_${m}_get_total_count;`)).rows[0].count,R={...await o.query(`EXECUTE live_query_${m}_get(${u}, ${y});`),offset:y,limit:u,totalCount:I}):(await o.exec(`
              PREPARE live_query_${m}_get AS
              SELECT * FROM live_query_${m}_view;
            `),R=await o.query(`EXECUTE live_query_${m}_get;`)),D=await Promise.all(_.map(E=>o.listen(`"table_change__${E.schema_oid}__${E.table_oid}"`,async()=>{L()})))})};await x();let L=ne(async({offset:o,limit:d}={})=>{if(!i&&(o!==void 0||d!==void 0))throw new Error("offset and limit cannot be provided for non-windowed queries");if(o&&(typeof o!="number"||isNaN(o))||d&&(typeof d!="number"||isNaN(d)))throw new Error("offset and limit must be numbers");y=o??y,u=d??u;let _=async(E=0)=>{if(w.length!==0){try{i?R={...await e.query(`EXECUTE live_query_${m}_get(${u}, ${y});`),offset:y,limit:u,totalCount:I}:R=await e.query(`EXECUTE live_query_${m}_get;`)}catch(g){let f=g.message;if(f.startsWith(`prepared statement "live_query_${m}`)&&f.endsWith("does not exist")){if(E>it)throw g;await x(),_(E+1)}else throw g}if(z(w,R),i){let g=(await e.query(`EXECUTE live_query_${m}_get_total_count;`)).rows[0].count;g!==I&&(I=g,L())}}};await _()}),B=o=>{if(v)throw new Error("Live query is no longer active and cannot be subscribed to");w.push(o)},p=async o=>{o?w=w.filter(d=>d!==d):w=[],w.length===0&&!v&&(v=!0,await e.transaction(async d=>{await Promise.all(D.map(_=>_(d))),await d.exec(`
              DROP VIEW IF EXISTS live_query_${m}_view;
              DEALLOCATE live_query_${m}_get;
            `)}))};return b?.aborted?await p():b?.addEventListener("abort",()=>{p()},{once:!0}),z(w,R),{initialResults:R,subscribe:B,unsubscribe:p,refresh:L}},async changes(r,c,a,b){let y;if(typeof r!="string"&&(y=r.signal,c=r.params,a=r.key,b=r.callback,r=r.query),!a)throw new Error("key is required for changes queries");let u=b?[b]:[],i=ee().replace(/-/g,""),I=!1,w=1,m,v,R=async()=>{await e.transaction(async p=>{let o=await te(e,r,c,p);await p.query(`CREATE OR REPLACE TEMP VIEW live_query_${i}_view AS ${o}`);let d=await fe(p,`live_query_${i}_view`);await pe(p,d,n);let _=[...(await p.query(`
                SELECT column_name, data_type, udt_name
                FROM information_schema.columns 
                WHERE table_name = 'live_query_${i}_view'
              `)).rows,{column_name:"__after__",data_type:"integer"}];await p.exec(`
            CREATE TEMP TABLE live_query_${i}_state1 (LIKE live_query_${i}_view INCLUDING ALL);
            CREATE TEMP TABLE live_query_${i}_state2 (LIKE live_query_${i}_view INCLUDING ALL);
          `);for(let E of[1,2]){let g=E===1?2:1;await p.exec(`
              PREPARE live_query_${i}_diff${E} AS
              WITH
                prev AS (SELECT LAG("${a}") OVER () as __after__, * FROM live_query_${i}_state${g}),
                curr AS (SELECT LAG("${a}") OVER () as __after__, * FROM live_query_${i}_state${E}),
                data_diff AS (
                  -- INSERT operations: Include all columns
                  SELECT 
                    'INSERT' AS __op__,
                    ${_.map(({column_name:f})=>`curr."${f}" AS "${f}"`).join(`,
`)},
                    ARRAY[]::text[] AS __changed_columns__
                  FROM curr
                  LEFT JOIN prev ON curr.${a} = prev.${a}
                  WHERE prev.${a} IS NULL
                UNION ALL
                  -- DELETE operations: Include only the primary key
                  SELECT 
                    'DELETE' AS __op__,
                    ${_.map(({column_name:f,data_type:M,udt_name:X})=>f===a?`prev."${f}" AS "${f}"`:`NULL${M==="USER-DEFINED"?`::${X}`:""} AS "${f}"`).join(`,
`)},
                      ARRAY[]::text[] AS __changed_columns__
                  FROM prev
                  LEFT JOIN curr ON prev.${a} = curr.${a}
                  WHERE curr.${a} IS NULL
                UNION ALL
                  -- UPDATE operations: Include only changed columns
                  SELECT 
                    'UPDATE' AS __op__,
                    ${_.map(({column_name:f,data_type:M,udt_name:X})=>f===a?`curr."${f}" AS "${f}"`:`CASE 
                              WHEN curr."${f}" IS DISTINCT FROM prev."${f}" 
                              THEN curr."${f}"
                              ELSE NULL${M==="USER-DEFINED"?`::${X}`:""}
                              END AS "${f}"`).join(`,
`)},
                      ARRAY(SELECT unnest FROM unnest(ARRAY[${_.filter(({column_name:f})=>f!==a).map(({column_name:f})=>`CASE
                              WHEN curr."${f}" IS DISTINCT FROM prev."${f}" 
                              THEN '${f}' 
                              ELSE NULL 
                              END`).join(", ")}]) WHERE unnest IS NOT NULL) AS __changed_columns__
                  FROM curr
                  INNER JOIN prev ON curr.${a} = prev.${a}
                  WHERE NOT (curr IS NOT DISTINCT FROM prev)
                )
              SELECT * FROM data_diff;
            `)}v=await Promise.all(d.map(E=>p.listen(`"table_change__${E.schema_oid}__${E.table_oid}"`,async()=>{D()})))})};await R();let D=ne(async()=>{if(u.length===0&&m)return;let p=!1;for(let o=0;o<5;o++)try{await e.transaction(async d=>{await d.exec(`
                INSERT INTO live_query_${i}_state${w} 
                  SELECT * FROM live_query_${i}_view;
              `),m=await d.query(`EXECUTE live_query_${i}_diff${w};`),w=w===1?2:1,await d.exec(`
                TRUNCATE live_query_${i}_state${w};
              `)});break}catch(d){if(d.message===`relation "live_query_${i}_state${w}" does not exist`){p=!0,await R();continue}else throw d}ct(u,[...p?[{__op__:"RESET"}]:[],...m.rows])}),x=p=>{if(I)throw new Error("Live query is no longer active and cannot be subscribed to");u.push(p)},L=async p=>{p?u=u.filter(o=>o!==o):u=[],u.length===0&&!I&&(I=!0,await e.transaction(async o=>{await Promise.all(v.map(d=>d(o))),await o.exec(`
              DROP VIEW IF EXISTS live_query_${i}_view;
              DROP TABLE IF EXISTS live_query_${i}_state1;
              DROP TABLE IF EXISTS live_query_${i}_state2;
              DEALLOCATE live_query_${i}_diff1;
              DEALLOCATE live_query_${i}_diff2;
            `)}))};return y?.aborted?await L():y?.addEventListener("abort",()=>{L()},{once:!0}),await D(),{fields:m.fields.filter(p=>!["__after__","__op__","__changed_columns__"].includes(p.name)),initialChanges:m.rows,subscribe:x,unsubscribe:L,refresh:D}},async incrementalQuery(r,c,a,b){let y;if(typeof r!="string"&&(y=r.signal,c=r.params,a=r.key,b=r.callback,r=r.query),!a)throw new Error("key is required for incremental queries");let u=b?[b]:[],i=new Map,I=new Map,w=[],m=!0,{fields:v,unsubscribe:R,refresh:D}=await s.changes(r,c,a,B=>{for(let d of B){let{__op__:_,__changed_columns__:E,...g}=d;switch(_){case"RESET":i.clear(),I.clear();break;case"INSERT":i.set(g[a],g),I.set(g.__after__,g[a]);break;case"DELETE":{let f=i.get(g[a]);i.delete(g[a]),f.__after__!==null&&I.delete(f.__after__);break}case"UPDATE":{let f={...i.get(g[a])??{}};for(let M of E)f[M]=g[M],M==="__after__"&&I.set(g.__after__,g[a]);i.set(g[a],f);break}}}let p=[],o=null;for(let d=0;d<i.size;d++){let _=I.get(o),E=i.get(_);if(!E)break;let g={...E};delete g.__after__,p.push(g),o=_}w=p,m||z(u,{rows:p,fields:v})});m=!1,z(u,{rows:w,fields:v});let x=B=>{u.push(B)},L=async B=>{B?u=u.filter(p=>p!==p):u=[],u.length===0&&await R()};return y?.aborted?await L():y?.addEventListener("abort",()=>{L()},{once:!0}),{initialResults:{rows:w,fields:v},subscribe:x,unsubscribe:L,refresh:D}}};return{namespaceObj:s}},lt={name:"Live Queries",setup:ot};async function fe(e,t){return(await e.query(`
      WITH RECURSIVE view_dependencies AS (
        -- Base case: Get the initial view's dependencies
        SELECT DISTINCT
          cl.relname AS dependent_name,
          n.nspname AS schema_name,
          cl.oid AS dependent_oid,
          n.oid AS schema_oid,
          cl.relkind = 'v' AS is_view
        FROM pg_rewrite r
        JOIN pg_depend d ON r.oid = d.objid
        JOIN pg_class cl ON d.refobjid = cl.oid
        JOIN pg_namespace n ON cl.relnamespace = n.oid
        WHERE
          r.ev_class = (
              SELECT oid FROM pg_class WHERE relname = $1 AND relkind = 'v'
          )
          AND d.deptype = 'n'

        UNION ALL

        -- Recursive case: Traverse dependencies for views
        SELECT DISTINCT
          cl.relname AS dependent_name,
          n.nspname AS schema_name,
          cl.oid AS dependent_oid,
          n.oid AS schema_oid,
          cl.relkind = 'v' AS is_view
        FROM view_dependencies vd
        JOIN pg_rewrite r ON vd.dependent_name = (
          SELECT relname FROM pg_class WHERE oid = r.ev_class AND relkind = 'v'
        )
        JOIN pg_depend d ON r.oid = d.objid
        JOIN pg_class cl ON d.refobjid = cl.oid
        JOIN pg_namespace n ON cl.relnamespace = n.oid
        WHERE d.deptype = 'n'
      )
      SELECT DISTINCT
        dependent_name AS table_name,
        schema_name,
        dependent_oid AS table_oid,
        schema_oid
      FROM view_dependencies
      WHERE NOT is_view; -- Exclude intermediate views
    `,[t])).rows.map(s=>({table_name:s.table_name,schema_name:s.schema_name,table_oid:s.table_oid,schema_oid:s.schema_oid}))}async function pe(e,t,n){let s=t.filter(r=>!n.has(`${r.schema_oid}_${r.table_oid}`)).map(r=>`
      CREATE OR REPLACE FUNCTION "_notify_${r.schema_oid}_${r.table_oid}"() RETURNS TRIGGER AS $$
      BEGIN
        PERFORM pg_notify('table_change__${r.schema_oid}__${r.table_oid}', '');
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
      CREATE OR REPLACE TRIGGER "_notify_trigger_${r.schema_oid}_${r.table_oid}"
      AFTER INSERT OR UPDATE OR DELETE ON "${r.schema_name}"."${r.table_name}"
      FOR EACH STATEMENT EXECUTE FUNCTION "_notify_${r.schema_oid}_${r.table_oid}"();
      `).join(`
`);s.trim()!==""&&await e.exec(s),t.map(r=>n.add(`${r.schema_oid}_${r.table_oid}`))}var z=(e,t)=>{for(let n of e)n(t)},ct=(e,t)=>{for(let n of e)n(t)};0&&(module.exports={live});
//# sourceMappingURL=index.cjs.map