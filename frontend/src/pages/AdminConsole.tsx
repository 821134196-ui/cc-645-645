import { useEffect, useState } from 'react';
import { api, apiClient } from '../api';
import type { LicenseView } from '../types';
import { AccessLogs, History, Licenses, Notify, RenewDue } from './adminViews';

type View = 'renew' | 'licenses' | 'history' | 'logs' | 'notify';

export default function AdminConsole({ view }: { view: View }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [renewTarget, setRenewTarget] = useState<LicenseView | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const bump = () => setReloadKey((k) => k + 1);

  return (
    <>
      {view === 'renew' && (
        <>
          <div style={{ marginBottom: 12 }}>
            <button className="btn" onClick={() => { setRenewTarget(null); setIssueOpen(true); }}>
              登记新授权
            </button>
          </div>
          <RenewDue onRenew={(l) => { setRenewTarget(l); setIssueOpen(true); }} />
        </>
      )}
      {view === 'licenses' && (
        <>
          <div style={{ marginBottom: 12 }}>
            <button className="btn" onClick={() => { setRenewTarget(null); setIssueOpen(true); }}>
              登记新授权
            </button>
          </div>
          <Licenses view="licenses" onRenew={(l) => { setRenewTarget(l); setIssueOpen(true); }} reloadKey={reloadKey} onChanged={bump} />
        </>
      )}
      {view === 'history' && <History reloadKey={reloadKey} />}
      {view === 'logs' && <AccessLogs />}
      {view === 'notify' && <Notify />}

      {issueOpen && (
        <IssueRenewModal
          oldLicense={renewTarget}
          onClose={() => setIssueOpen(false)}
          onDone={() => { setIssueOpen(false); bump(); }}
        />
      )}
    </>
  );
}

function IssueRenewModal({
  oldLicense, onClose, onDone,
}: {
  oldLicense: LicenseView | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const isRenew = !!oldLicense;
  const [courses, setCourses] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [courseId, setCourseId] = useState(oldLicense?.courseId || '');
  const [versionId, setVersionId] = useState('');
  const [deptIds, setDeptIds] = useState<string[]>(
    oldLicense?.departments.map((d) => d.id) || [],
  );
  const [validFrom, setValidFrom] = useState(toDateInput(new Date()));
  const [validUntil, setValidUntil] = useState(toDateInput(new Date(Date.now() + 365 * 86400000)));
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newVideo, setNewVideo] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiClient.coursesVersions().then((cs) => {
      setCourses(cs);
      if (!courseId && cs.length) setCourseId(cs[0].id);
    });
    apiClient.departments().then(setDepartments);
  }, []);

  // 续签时强制选择“同一课程的不同视频版本”；首次进入默认不选，避免误操作
  const currentCourse = courses.find((c) => c.id === courseId);
  const selectableVersions: any[] = (currentCourse?.versions || []).filter(
    (v: any) => !isRenew || v.id !== oldLicense!.versionId,
  );

  const uploadVersion = async () => {
    setError('');
    if (!newVideo || !newLabel.trim()) { setError('请填写新版本号并选择视频文件'); return; }
    const fd = new FormData();
    fd.append('video', newVideo);
    fd.append('courseId', courseId);
    fd.append('versionLabel', newLabel.trim());
    const created = await api<any>('/admin/versions', { method: 'POST', body: fd });
    setCourses(await apiClient.coursesVersions());
    setVersionId(created.id);
    setShowUpload(false);
    setNewLabel(''); setNewVideo(null);
  };

  const submit = async () => {
    setError('');
    if (!versionId) { setError('请选择视频版本'); return; }
    if (!licenseFile) { setError('请上传许可文件（每次签发/续签都需登记新文件）'); return; }
    if (!deptIds.length) { setError('请至少选择一个可观看部门'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('versionId', versionId);
      if (isRenew) fd.append('oldLicenseId', oldLicense!.id);
      fd.append('licenseFile', licenseFile);
      fd.append('validFrom', new Date(validFrom).toISOString());
      fd.append('validUntil', new Date(validUntil).toISOString());
      deptIds.forEach((d) => fd.append('departmentIds', d));
      await api('/admin/licenses', { method: 'POST', body: fd });
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>{isRenew ? `续签：${oldLicense!.courseTitle}` : '登记新授权'}</h3>
        {isRenew && (
          <div className="banner">
            正在为《{oldLicense!.courseTitle}》{oldLicense!.versionLabel}（{oldLicense!.departments.map((d) => d.name).join('、')}，
            到期 {new Date(oldLicense!.validUntil).toLocaleDateString()}）续签。
            续签将产生一条<b>全新许可记录</b>，旧许可只标记被接替，截止日期不会被修改。
          </div>
        )}
        {error && <div className="error">{error}</div>}

        <div className="field">
          <label>课程</label>
          <select
            value={courseId}
            disabled={isRenew}
            onChange={(e) => { setCourseId(e.target.value); setVersionId(''); }}
          >
            {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </div>

        <div className="field">
          <label>视频版本（续签必须选择对应课程的新版本，不能在旧版本上直接延期）</label>
          <select value={versionId} onChange={(e) => setVersionId(e.target.value)}>
            <option value="">— 请选择版本 —</option>
            {selectableVersions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.versionLabel}
                {isRenew && v.id === oldLicense!.versionId ? '（旧版本，不可选）' : ''}
              </option>
            ))}
          </select>
          <div style={{ marginTop: 8 }}>
            {!showUpload ? (
              <button type="button" className="btn sm ghost" onClick={() => setShowUpload(true)}>+ 上传新视频版本</button>
            ) : (
              <div className="panel" style={{ background: '#f8fafc', padding: 14 }}>
                <div className="row">
                  <div className="field" style={{ minWidth: 100 }}>
                    <label>新版本号</label>
                    <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="如 v3" />
                  </div>
                  <div className="field" style={{ flex: 2 }}>
                    <label>本地视频文件</label>
                    <input type="file" accept="video/*" onChange={(e) => setNewVideo(e.target.files?.[0] || null)} />
                  </div>
                </div>
                <button type="button" className="btn sm" onClick={uploadVersion}>上传并选用</button>{' '}
                <button type="button" className="btn sm ghost" onClick={() => setShowUpload(false)}>取消</button>
              </div>
            )}
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>生效日期</label>
            <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </div>
          <div className="field">
            <label>截止日期</label>
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label>可观看部门</label>
          <div className="checkbox-list">
            {departments.map((d) => (
              <label key={d.id}>
                <input
                  type="checkbox"
                  checked={deptIds.includes(d.id)}
                  onChange={(e) =>
                    setDeptIds(e.target.checked ? [...deptIds, d.id] : deptIds.filter((x) => x !== d.id))
                  }
                />
                {d.name}
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <label>许可文件（必填，续签须重新登记）</label>
          <input type="file" onChange={(e) => setLicenseFile(e.target.files?.[0] || null)} />
        </div>

        <div className="actions">
          <button className="btn ghost" onClick={onClose}>取消</button>
          <button className="btn" disabled={busy} onClick={submit}>
            {busy ? '提交中…' : isRenew ? '确认续签（生成新记录）' : '登记授权'}
          </button>
        </div>
      </div>
    </div>
  );
}

function toDateInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
