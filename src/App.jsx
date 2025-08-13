import React, { useEffect, useMemo, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";

const API_BASE = import.meta.env.VITE_API_BASE || "https://localhost:7249";
const API_SCOPE = (import.meta.env.VITE_API_SCOPE || "").trim();
const BYPASS = String(import.meta.env.VITE_BYPASS_AUTH || "").toLowerCase() === "true";

export default function App() {
  const { instance, accounts, inProgress } = useMsal();
  const isBusy = inProgress !== InteractionStatus.None;
  const activeAccount = useMemo(() => accounts[0] || instance.getActiveAccount(), [accounts, instance]);

  const [text, setText] = useState(
    "Admitted with community-acquired pneumonia. Background of COPD. CXR performed, nebulisation and oxygen therapy."
  );
  const [result, setResult] = useState(null);

  const [episodes, setEpisodes] = useState([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [selectedEpisodeId, setSelectedEpisodeId] = useState(null);
  const [codeDiff, setCodeDiff] = useState(null);

  const [to, setTo] = useState("dr.smith@hospital.nhs.uk");
  const [subject, setSubject] = useState("Clinical Coding Query");
  const [body, setBody] = useState("Could you clarify the pneumonia aetiology and site?");

  const [err, setErr] = useState("");

  // ----- helpers -----
  const getRoles = () => {
    const idt = activeAccount?.idTokenClaims || {};
    const roles = idt.roles || [];
    return Array.isArray(roles) ? roles : [];
  };
  const hasRole = (r) => getRoles().includes(r);

  const login = async () => {
    if (BYPASS || isBusy) return;
    const scopes = API_SCOPE ? ["openid", "profile", API_SCOPE] : ["openid", "profile"];
    try {
      await instance.loginPopup({ scopes });
    } catch (e) {
      if (e?.errorCode === "popup_window_error" || e?.errorCode === "user_cancelled") {
        await instance.loginRedirect({ scopes });
      } else if (e?.errorCode !== "interaction_in_progress") {
        console.warn("[MSAL] login error:", e);
        alert("Sign-in failed. See console for details.");
      }
    }
  };

  const logout = async () => {
    if (BYPASS) return;
    await instance.logoutPopup().catch(() => {});
  };

  const callApi = async (path, body, methodOverride) => {
    const url = `${API_BASE}/${path}`;
    const headers = { "Content-Type": "application/json" };

    if (!BYPASS) {
      if (!activeAccount) throw new Error("Not signed in.");
      const scopes = API_SCOPE ? [API_SCOPE] : ["openid", "profile"];
      let token;
      try {
        token = await instance.acquireTokenSilent({ account: activeAccount, scopes });
      } catch (e) {
        if (e?.errorCode === "interaction_required" || e?.errorCode === "consent_required") {
          await instance.loginPopup({ scopes });
          token = await instance.acquireTokenSilent({ account: instance.getActiveAccount(), scopes });
        } else {
          throw e;
        }
      }
      headers["Authorization"] = `Bearer ${token.accessToken}`;
    }

    const res = await fetch(url, {
      method: methodOverride || (body ? "POST" : "GET"),
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return null;
    const txt = await res.text();
    if (!res.ok) {
      const msg = `${res.status} ${res.statusText}${txt ? `: ${txt}` : ""}`;
      throw new Error(msg);
    }
    return txt ? JSON.parse(txt) : null;
  };

  // ----- actions -----
  const suggest = async () => {
    const ep = {
      nhsNumber: "9999999999",
      patientName: "John Smith",
      admissionDate: new Date().toISOString(),
      specialty: "Respiratory Medicine",
      sourceText: text,
    };
    const data = await callApi("episodes/suggest", ep);
    setResult(data);
  };

  const create = async () => {
    const ep = {
      nhsNumber: "9999999999",
      patientName: "John Smith",
      admissionDate: new Date().toISOString(),
      specialty: "Respiratory Medicine",
      sourceText: text,
    };
    await callApi("episodes", ep);
    await list();
  };

  const list = async () => {
    setErr("");
    try {
      const qs = new URLSearchParams();
      if (statusFilter !== "") qs.set("status", statusFilter);
      if (fromDate) qs.set("from", new Date(fromDate).toISOString());
      if (toDate) qs.set("to", new Date(toDate).toISOString());
      qs.set("page", String(page));
      qs.set("pageSize", String(pageSize));

      const data = await callApi(`episodes?${qs.toString()}`);
      const items = Array.isArray(data) ? data : data?.items ?? [];
	  console.log("GET /episodes", { count: items.length, total: data?.total ?? items.length });
      setEpisodes(items);
      setTotal(Array.isArray(data) ? items.length : data?.total ?? items.length);
    } catch (e) {
      console.warn("List episodes failed:", e);
      setErr(String(e.message || e));
    }
  };

  const submit = async (episodeId) => {
    await callApi(`episodes/${episodeId}/submit`, null, "POST");
    await list();
  };
  const approve = async (episodeId) => {
    await callApi(`episodes/${episodeId}/approve?notes=Looks%20good`, null, "POST");
    await list();
  };
  const reject = async (episodeId) => {
    await callApi(`episodes/${episodeId}/reject?notes=Needs%20more%20detail`, null, "POST");
    await list();
  };

  const createQuery = async (episodeId) => {
    await callApi(`episodes/${episodeId}/queries`, { to, subject, body }, "POST");
    alert("Query drafted and sent to Power Automate webhook (if configured).");
  };
  
 const [uploadFile, setUploadFile] = useState(null);
 const [uploadCodes, setUploadCodes] = useState(""); // optional JSON or CSV
 const [uploadDiff, setUploadDiff] = useState(null);

 const analyzeUpload = async () => {
  if (!uploadFile) { alert("Please choose a file first."); return; }
  const form = new FormData();
  form.append("file", uploadFile);
  if (uploadCodes.trim()) form.append("codes", uploadCodes);

  const url = `${API_BASE}/episodes/compare-upload`;
  const headers = {};
  // attach bearer if not bypassing
  if (!BYPASS) {
    const account = accounts[0] || instance.getActiveAccount();
    const scopes = API_SCOPE ? [API_SCOPE] : ["openid","profile"];
    const tokenResp = await instance.acquireTokenSilent({ account, scopes });
    headers["Authorization"] = `Bearer ${tokenResp.accessToken}`;
  }

  const res = await fetch(url, { method: "POST", headers, body: form });
  const txt = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${txt}`);
  const data = txt ? JSON.parse(txt) : null;
  setUploadDiff(data);
};

  const loadDiff = async (episodeId) => {
    const data = await callApi(`episodes/${episodeId}/code-diff`);
    setSelectedEpisodeId(episodeId);
    setCodeDiff(data);
  };

  const revertToOld = async () => {
    if (!codeDiff) return;
    await callApi(`episodes/${selectedEpisodeId}/revert?auditId=${codeDiff.auditId}`, null, "POST");
    alert("Reverted to old codes.");
    await list();
    setCodeDiff(null);
  };

  // ----- effects -----
  useEffect(() => {
    if (BYPASS || activeAccount) {
      list().catch((e) => console.warn("List episodes failed:", e.message));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [BYPASS, activeAccount, statusFilter, fromDate, toDate, page, pageSize]);

  // ----- UI -----
  return (
    <>
      {err && (
        <div style={{ background: "#fdecea", border: "1px solid #f5c2c7", color: "#b02a37", padding: 8, marginTop: 12 }}>
          Failed to load episodes: {err}
        </div>
      )}

      <div style={{ maxWidth: 960, margin: "2rem auto", fontFamily: "system-ui, Arial" }}>
        <h1>Clinical Coding Admin</h1>

        {!BYPASS && !activeAccount ? (
          <button onClick={login} disabled={isBusy}>
            {isBusy ? "Signing in…" : "Sign in"}
          </button>
        ) : (
          <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
            <div>
              Signed in as <b>{activeAccount?.username || "dev-bypass"}</b>
            </div>
            {!BYPASS && (
              <button onClick={logout} disabled={isBusy}>
                Sign out
              </button>
            )}
          </div>
        )}

        {!API_SCOPE && !BYPASS && (
          <div style={{ background: "#fff3cd", border: "1px solid #ffeeba", padding: 8, marginTop: 12 }}>
            <b>Config:</b> <code>VITE_API_SCOPE</code> is not set. Login will work with OIDC, but API calls may fail.
          </div>
        )}

        <h2 style={{ marginTop: 24 }}>Suggest Codes</h2>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} style={{ width: "100%" }} />
        <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
          <button onClick={suggest} disabled={!BYPASS && !activeAccount}>
            Get Suggestions
          </button>
          <button onClick={create} disabled={!BYPASS && !activeAccount}>
            Create Episode
          </button>
          <button onClick={list}>List Episodes</button>
        </div>

        {result && (
          <div style={{ marginTop: "1rem" }}>
            <h3>Result</h3>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </div>
        )}
<div style={{marginTop: "2rem"}}>
  <h2>Upload & Compare (coder vs system)</h2>
  <div style={{display:"grid", gap: 8}}>
    <input type="file" accept=".txt,.csv,.json,.docx,.pdf" onChange={(e)=>setUploadFile(e.target.files?.[0] ?? null)} />
    <textarea rows={5}
      placeholder='Optional: paste coder codes (JSON or CSV). Example JSON:
{ "diagnoses":[{"code":"A41.9","description":"Sepsis","isPrimary":true}], "procedures":[] }'
      value={uploadCodes} onChange={(e)=>setUploadCodes(e.target.value)} />
    <div><button onClick={analyzeUpload}>Analyze Upload</button></div>
  </div>

  {uploadDiff && (
    <div style={{marginTop:12, padding:12, border:"1px solid #ddd"}}>
      <h3>Comparison</h3>
      {uploadDiff.narrativePreview && (
        <details style={{marginBottom:8}}>
          <summary>Narrative preview</summary>
          <pre style={{whiteSpace:"pre-wrap"}}>{uploadDiff.narrativePreview}</pre>
        </details>
      )}
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:12}}>
        <div>
          <h4>Old Diagnoses (Coder)</h4>
          <ul>{uploadDiff.dx.old.map((d,i)=>(
            <li key={i}>{d.code ?? d.Code} — {d.description ?? d.Description}{(d.isPrimary ?? d.IsPrimary) ? " (primary)" : ""}</li>
          ))}</ul>
          <h4>Old Procedures (Coder)</h4>
          <ul>{uploadDiff.px.old.map((p,i)=>(
            <li key={i}>{p.code ?? p.Code} — {p.description ?? p.Description}</li>
          ))}</ul>
        </div>
        <div>
          <h4>New Diagnoses (System)</h4>
          <ul>{uploadDiff.dx.new.map((d,i)=>(
            <li key={i}>{d.code ?? d.Code} — {d.description ?? d.Description}{(d.isPrimary ?? d.IsPrimary) ? " (primary)" : ""}</li>
          ))}</ul>
          <h4>New Procedures (System)</h4>
          <ul>{uploadDiff.px.new.map((p,i)=>(
            <li key={i}>{p.code ?? p.Code} — {p.description ?? p.Description}</li>
          ))}</ul>
        </div>
      </div>
      <div style={{marginTop:8}}>
        <b>Deltas:</b>
        <div>Dx Added: {uploadDiff.deltas.dxAdded.join(", ") || "—"}</div>
        <div>Dx Removed: {uploadDiff.deltas.dxRemoved.join(", ") || "—"}</div>
        <div>Px Added: {uploadDiff.deltas.pxAdded.join(", ") || "—"}</div>
        <div>Px Removed: {uploadDiff.deltas.pxRemoved.join(", ") || "—"}</div>
      </div>
    </div>
  )}
</div>

        <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <label>
            Status:&nbsp;
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Any</option>
              <option value="0">Draft</option>
              <option value="1">Submitted</option>
              <option value="2">Approved</option>
              <option value="3">Rejected</option>
            </select>
          </label>
          <label>
            From: <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label>
            To: <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
          <a href={`${API_BASE}/export/episodes.csv`} target="_blank" rel="noreferrer">
            Export CSV
          </a>
          <a href={`${API_BASE}/export/episodes.json`} target="_blank" rel="noreferrer">
            Export JSON
          </a>
        </div>

        {!err && episodes?.length === 0 && (
          <div style={{ marginTop: "1rem", color: "#555" }}>
            No episodes yet (or filtered out). Click <b>Create Episode</b> then <b>List Episodes</b>.
          </div>
        )}

        {episodes?.length > 0 && (
  <div style={{ marginTop: "1rem" }}>
    <h3>Recent Episodes {total ? `(${total})` : ""}</h3>
    <table width="100%" cellPadding="6" style={{borderCollapse:'collapse'}}>
      <thead>
        <tr style={{textAlign:'left', borderBottom:'1px solid #ddd'}}>
          <th>Patient</th><th>Admission</th><th>Specialty</th><th>Status</th><th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {episodes
          .filter(e => statusFilter === "" || (e.status ?? e.Status) == Number(statusFilter))
          .map((e) => {
            const id = e.id ?? e.Id;
            const patientName = e.patientName ?? e.PatientName ?? "(unnamed)";
            const admit = e.admissionDate ?? e.AdmissionDate;
            const specialty = e.specialty ?? e.Specialty ?? "";
            const status = e.status ?? e.Status ?? 0;
            return (
              <tr key={id} style={{borderBottom:'1px solid #eee'}}>
                <td><b>{patientName}</b></td>
                <td>{admit ? new Date(admit).toLocaleString() : "-"}</td>
                <td>{specialty}</td>
                <td>{status}</td>
                <td style={{display:'flex', gap:8}}>
                  {(hasRole("Coder") && status === 0) && (
                    <button onClick={() => submit(id)} disabled={!BYPASS && !activeAccount}>Submit</button>
                  )}
                  <button onClick={() => loadDiff(id)} disabled={!BYPASS && !activeAccount}>Diff</button>
                  {(hasRole("Reviewer") && status === 1) && (
                    <>
                      <button onClick={() => approve(id)} disabled={!BYPASS && !activeAccount}>Approve</button>
                      <button onClick={() => reject(id)} disabled={!BYPASS && !activeAccount}>Reject</button>
                    </>
                  )}
                  {hasRole("Coder") && (
                    <button onClick={() => createQuery(id)} disabled={!BYPASS && !activeAccount}>Query</button>
                  )}
                </td>
              </tr>
            );
          })}
      </tbody>
    </table>
  </div>
)}

        <div style={{ marginTop: "2rem" }}>
          <h3>Draft clinician query</h3>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            <input placeholder="Clinician email" value={to} onChange={(e) => setTo(e.target.value)} />
            <input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <textarea placeholder="Body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
            <small>Click “Draft Clinician Query” next to an episode to send via your Power Automate webhook.</small>
          </div>
        </div>

        {codeDiff && (
          <div style={{ marginTop: "1rem", padding: "1rem", border: "1px solid #ddd" }}>
            <h3>Code diff (latest re-suggestion)</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div>
                <h4>Old Diagnoses</h4>
                <ul>
                  {codeDiff.dx.old.map((d, i) => (
                    <li key={i}>
                      {d.Code} — {d.Description}
                      {d.IsPrimary ? " (primary)" : ""}
                    </li>
                  ))}
                </ul>
                <h4>Old Procedures</h4>
                <ul>
                  {codeDiff.px.old.map((p, i) => (
                    <li key={i}>
                      {p.Code} — {p.Description}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4>New Diagnoses</h4>
                <ul>
                  {codeDiff.dx["new"].map((d, i) => (
                    <li key={i}>
                      {d.Code} — {d.Description}
                      {d.IsPrimary ? " (primary)" : ""}
                    </li>
                  ))}
                </ul>
                <h4>New Procedures</h4>
                <ul>
                  {codeDiff.px["new"].map((p, i) => (
                    <li key={i}>
                      {p.Code} — {p.Description}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            {hasRole("Reviewer") && (
              <button onClick={revertToOld} style={{ marginTop: "0.5rem" }}>
                Revert to old codes
              </button>
            )}
            <button onClick={() => setCodeDiff(null)} style={{ marginLeft: "0.5rem" }}>
              Close
            </button>
          </div>
        )}
      </div>
    </>
  );
}
