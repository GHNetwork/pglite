import{v as I,w as O,x as C}from"../chunk-M6BJUVZ4.js";import{j as P}from"../chunk-AYAJAOZF.js";P();var M=5,U=async(d,y)=>{let $=new Set,p={async query(e,A,a){let m,l,_;if(typeof e!="string"&&(m=e.signal,A=e.params,a=e.callback,l=e.offset,_=e.limit,e=e.query),l===void 0!=(_===void 0))throw new Error("offset and limit must be provided together");let i=l!==void 0&&_!==void 0,T;if(i&&(typeof l!="number"||isNaN(l)||typeof _!="number"||isNaN(_)))throw new Error("offset and limit must be numbers");let E=a?[a]:[],o=I().replace(/-/g,""),g=!1,v,w,S=async()=>{await d.transaction(async t=>{let s=A&&A.length>0?await O(d,e,A,t):e;await t.exec(`CREATE OR REPLACE TEMP VIEW live_query_${o}_view AS ${s}`);let u=await q(t,`live_query_${o}_view`);await F(t,u,$),i?(await t.exec(`
              PREPARE live_query_${o}_get(int, int) AS
              SELECT * FROM live_query_${o}_view
              LIMIT $1 OFFSET $2;
            `),await t.exec(`
              PREPARE live_query_${o}_get_total_count AS
              SELECT COUNT(*) FROM live_query_${o}_view;
            `),T=(await t.query(`EXECUTE live_query_${o}_get_total_count;`)).rows[0].count,v={...await t.query(`EXECUTE live_query_${o}_get(${_}, ${l});`),offset:l,limit:_,totalCount:T}):(await t.exec(`
              PREPARE live_query_${o}_get AS
              SELECT * FROM live_query_${o}_view;
            `),v=await t.query(`EXECUTE live_query_${o}_get;`)),w=await Promise.all(u.map(f=>t.listen(`"table_change__${f.schema_oid}__${f.table_oid}"`,async()=>{R()})))})};await S();let R=C(async({offset:t,limit:s}={})=>{if(!i&&(t!==void 0||s!==void 0))throw new Error("offset and limit cannot be provided for non-windowed queries");if(t&&(typeof t!="number"||isNaN(t))||s&&(typeof s!="number"||isNaN(s)))throw new Error("offset and limit must be numbers");l=t??l,_=s??_;let u=async(f=0)=>{if(E.length!==0){try{i?v={...await d.query(`EXECUTE live_query_${o}_get(${_}, ${l});`),offset:l,limit:_,totalCount:T}:v=await d.query(`EXECUTE live_query_${o}_get;`)}catch(c){let n=c.message;if(n.startsWith(`prepared statement "live_query_${o}`)&&n.endsWith("does not exist")){if(f>M)throw c;return await S(),await u(f+1)}else throw c}if(N(E,v),i){let c=(await d.query(`EXECUTE live_query_${o}_get_total_count;`)).rows[0].count;c!==T&&(T=c,R())}}};await u()}),h=t=>{if(g)throw new Error("Live query is no longer active and cannot be subscribed to");E.push(t)},r=async t=>{t?E=E.filter(s=>s!==t):E=[],E.length===0&&!g&&(g=!0,await d.transaction(async s=>{await Promise.all(w.map(u=>u(s))),await s.exec(`
              DROP VIEW IF EXISTS live_query_${o}_view;
              DEALLOCATE live_query_${o}_get;
            `)}))};return m?.aborted?await r():m?.addEventListener("abort",()=>{r()},{once:!0}),N(E,v),{initialResults:v,subscribe:h,unsubscribe:r,refresh:R}},async changes(e,A,a,m){let l;if(typeof e!="string"&&(l=e.signal,A=e.params,a=e.key,m=e.callback,e=e.query),!a)throw new Error("key is required for changes queries");let _=m?[m]:[],i=I().replace(/-/g,""),T=!1,E=1,o,g,v=async()=>{await d.transaction(async r=>{let t=await O(d,e,A,r);await r.query(`CREATE OR REPLACE TEMP VIEW live_query_${i}_view AS ${t}`);let s=await q(r,`live_query_${i}_view`);await F(r,s,$);let u=[...(await r.query(`
                SELECT column_name, data_type, udt_name
                FROM information_schema.columns 
                WHERE table_name = 'live_query_${i}_view'
              `)).rows,{column_name:"__after__",data_type:"integer"}];await r.exec(`
            CREATE TEMP TABLE live_query_${i}_state1 (LIKE live_query_${i}_view INCLUDING ALL);
            CREATE TEMP TABLE live_query_${i}_state2 (LIKE live_query_${i}_view INCLUDING ALL);
          `);for(let f of[1,2]){let c=f===1?2:1;await r.exec(`
              PREPARE live_query_${i}_diff${f} AS
              WITH
                prev AS (SELECT LAG("${a}") OVER () as __after__, * FROM live_query_${i}_state${c}),
                curr AS (SELECT LAG("${a}") OVER () as __after__, * FROM live_query_${i}_state${f}),
                data_diff AS (
                  -- INSERT operations: Include all columns
                  SELECT 
                    'INSERT' AS __op__,
                    ${u.map(({column_name:n})=>`curr."${n}" AS "${n}"`).join(`,
`)},
                    ARRAY[]::text[] AS __changed_columns__
                  FROM curr
                  LEFT JOIN prev ON curr.${a} = prev.${a}
                  WHERE prev.${a} IS NULL
                UNION ALL
                  -- DELETE operations: Include only the primary key
                  SELECT 
                    'DELETE' AS __op__,
                    ${u.map(({column_name:n,data_type:L,udt_name:b})=>n===a?`prev."${n}" AS "${n}"`:`NULL${L==="USER-DEFINED"?`::${b}`:""} AS "${n}"`).join(`,
`)},
                      ARRAY[]::text[] AS __changed_columns__
                  FROM prev
                  LEFT JOIN curr ON prev.${a} = curr.${a}
                  WHERE curr.${a} IS NULL
                UNION ALL
                  -- UPDATE operations: Include only changed columns
                  SELECT 
                    'UPDATE' AS __op__,
                    ${u.map(({column_name:n,data_type:L,udt_name:b})=>n===a?`curr."${n}" AS "${n}"`:`CASE 
                              WHEN curr."${n}" IS DISTINCT FROM prev."${n}" 
                              THEN curr."${n}"
                              ELSE NULL${L==="USER-DEFINED"?`::${b}`:""}
                              END AS "${n}"`).join(`,
`)},
                      ARRAY(SELECT unnest FROM unnest(ARRAY[${u.filter(({column_name:n})=>n!==a).map(({column_name:n})=>`CASE
                              WHEN curr."${n}" IS DISTINCT FROM prev."${n}" 
                              THEN '${n}' 
                              ELSE NULL 
                              END`).join(", ")}]) WHERE unnest IS NOT NULL) AS __changed_columns__
                  FROM curr
                  INNER JOIN prev ON curr.${a} = prev.${a}
                  WHERE NOT (curr IS NOT DISTINCT FROM prev)
                )
              SELECT * FROM data_diff;
            `)}g=await Promise.all(s.map(f=>r.listen(`"table_change__${f.schema_oid}__${f.table_oid}"`,async()=>{w()})))})};await v();let w=C(async()=>{if(_.length===0&&o)return;let r=!1;for(let t=0;t<5;t++)try{await d.transaction(async s=>{await s.exec(`
                INSERT INTO live_query_${i}_state${E} 
                  SELECT * FROM live_query_${i}_view;
              `),o=await s.query(`EXECUTE live_query_${i}_diff${E};`),E=E===1?2:1,await s.exec(`
                TRUNCATE live_query_${i}_state${E};
              `)});break}catch(s){if(s.message===`relation "live_query_${i}_state${E}" does not exist`){r=!0,await v();continue}else throw s}D(_,[...r?[{__op__:"RESET"}]:[],...o.rows])}),S=r=>{if(T)throw new Error("Live query is no longer active and cannot be subscribed to");_.push(r)},R=async r=>{r?_=_.filter(t=>t!==r):_=[],_.length===0&&!T&&(T=!0,await d.transaction(async t=>{await Promise.all(g.map(s=>s(t))),await t.exec(`
              DROP VIEW IF EXISTS live_query_${i}_view;
              DROP TABLE IF EXISTS live_query_${i}_state1;
              DROP TABLE IF EXISTS live_query_${i}_state2;
              DEALLOCATE live_query_${i}_diff1;
              DEALLOCATE live_query_${i}_diff2;
            `)}))};return l?.aborted?await R():l?.addEventListener("abort",()=>{R()},{once:!0}),await w(),{fields:o.fields.filter(r=>!["__after__","__op__","__changed_columns__"].includes(r.name)),initialChanges:o.rows,subscribe:S,unsubscribe:R,refresh:w}},async incrementalQuery(e,A,a,m){let l;if(typeof e!="string"&&(l=e.signal,A=e.params,a=e.key,m=e.callback,e=e.query),!a)throw new Error("key is required for incremental queries");let _=m?[m]:[],i=new Map,T=new Map,E=[],o=!0,{fields:g,unsubscribe:v,refresh:w}=await p.changes(e,A,a,h=>{for(let s of h){let{__op__:u,__changed_columns__:f,...c}=s;switch(u){case"RESET":i.clear(),T.clear();break;case"INSERT":i.set(c[a],c),T.set(c.__after__,c[a]);break;case"DELETE":{let n=i.get(c[a]);i.delete(c[a]),n.__after__!==null&&T.delete(n.__after__);break}case"UPDATE":{let n={...i.get(c[a])??{}};for(let L of f)n[L]=c[L],L==="__after__"&&T.set(c.__after__,c[a]);i.set(c[a],n);break}}}let r=[],t=null;for(let s=0;s<i.size;s++){let u=T.get(t),f=i.get(u);if(!f)break;let c={...f};delete c.__after__,r.push(c),t=u}E=r,o||N(_,{rows:r,fields:g})});o=!1,N(_,{rows:E,fields:g});let S=h=>{_.push(h)},R=async h=>{h?_=_.filter(r=>r!==h):_=[],_.length===0&&await v()};return l?.aborted?await R():l?.addEventListener("abort",()=>{R()},{once:!0}),{initialResults:{rows:E,fields:g},subscribe:S,unsubscribe:R,refresh:w}}};return{namespaceObj:p}},j={name:"Live Queries",setup:U};async function q(d,y){return(await d.query(`
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
    `,[y])).rows.map(p=>({table_name:p.table_name,schema_name:p.schema_name,table_oid:p.table_oid,schema_oid:p.schema_oid}))}async function F(d,y,$){let p=y.filter(e=>!$.has(`${e.schema_oid}_${e.table_oid}`)).map(e=>`
      CREATE OR REPLACE FUNCTION "_notify_${e.schema_oid}_${e.table_oid}"() RETURNS TRIGGER AS $$
      BEGIN
        PERFORM pg_notify('table_change__${e.schema_oid}__${e.table_oid}', '');
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
      CREATE OR REPLACE TRIGGER "_notify_trigger_${e.schema_oid}_${e.table_oid}"
      AFTER INSERT OR UPDATE OR DELETE ON "${e.schema_name}"."${e.table_name}"
      FOR EACH STATEMENT EXECUTE FUNCTION "_notify_${e.schema_oid}_${e.table_oid}"();
      ALTER TABLE "${e.schema_name}"."${e.table_name}" ENABLE ALWAYS TRIGGER "_notify_trigger_${e.schema_oid}_${e.table_oid}";
      `).join(`
`);p.trim()!==""&&await d.exec(p),y.forEach(e=>$.add(`${e.schema_oid}_${e.table_oid}`))}var N=(d,y)=>{for(let $ of d)$(y)},D=(d,y)=>{for(let $ of d)$(y)};export{j as live};
//# sourceMappingURL=index.js.map