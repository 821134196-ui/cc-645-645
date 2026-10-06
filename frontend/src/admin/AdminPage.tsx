import { useEffect, useState, useCallback } from 'react';
import { api, fmtDate, fmtDateTime, toDateInput } from '../api';

interface Department {
  id: string;
  name: string;
}
interface LicenseRow {
  id: string;
  versionId: string;
  status: 'ACTIVE' | 'SUPERSEDED' | 'REVOKED';
  timeState: 'VALID' | 'DUE_SOON' | 'EXPIRED_PENDING' | null;
  validFrom: string;
  validUntil: string;
  revokeReason: string | null;
  note: string | null;
  licenseFileName: string;
  createdAt: string;
  version: { versionLabel: string; lecturer: string; course: { title: string } };
  departments: Array<{ departmentId: string; department: { id: string; name: string } }>;
}
interface DueRow extends LicenseRow {
  overdue: boolean;
  daysLeft: number;
}
interface VersionRow {
  id: string;
  versionLabel: string;
  lecturer: string;
  fileName: string;
  licenses: LicenseRow[];
}
interface CourseRow {
  id: string;
  title: string;
  description: string | null;
  versions: VersionRow[];
}
interface AccessLogRow {
  id: string;
  action: string;
  result: string;
  reason: string | null;
  ip: string | null;
  createdAt: string;
  user: { name: string; department: { name: string } } | null;
  version: { versionLabel: string; course: { title: string } } | null;
}
interface ReminderRow {
  id: string;
  channel: string;
  content: string;
  sentAt: string;
  license: { version: { course: { title: string }; versionLabel: string } };
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: '生效中',
  SUPERSEDED: '已续签替代',
  REVOKED: '已下架',
};

export function AdminPage() {
  const [tab, setTab] = useState('due');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    api<Department[]>('/admin/departments').then(setDepartments);
    api<CourseRow[]>('/admin/courses').then(setCourses);
  }, []);

  const showToast = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 4000);
  };
  const reloadCourses = useCallback(() => {
    api<CourseRow[]>('/admin/courses').then(setCourses);
  }, []);

  return (
    <div>
      {toast && (
        <div className={`toast ${toast.ok ? 'ok' : 'bad'}`}>
          {toast.ok ? '✓ ' : '✗ '}
          {toast.msg}
        </div>
      )}
      <div className="tabs">
        {[
          ['due', '未来一周续签'],
          ['licenses', '许可管理'],
          ['courses', '课程与版本'],
          ['logs', '访问记录'],
          ['reminders', '模拟提醒'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'tab active' : 'tab'}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'due' && (
        <RenewalDueTab
          departments={departments}
          courses={courses}
          onChanged={() => {
            showToast(true, '续签成功：已生成新许可记录，旧许可标记为“已续签替代”');
            reloadCourses();
          }}
          onError={(m) => showToast(false, m)}
        />
      )}
      {tab === 'licenses' && (
        <LicensesTab
          departments={departments}
          courses={courses}
          onChanged={reloadCourses}
          onToast={showToast}
        />
      )}
      {tab === 'courses' && <CoursesTab courses={courses} onChanged={reloadCourses} onToast={showToast} />}
      {tab === 'logs' && <AccessLogsTab courses={courses} />}
      {tab === 'reminders' && <RemindersTab />}
    </div>
  );
}

/* ---------------- 续签清单 ---------------- */

function RenewalDueTab({
  departments,
  courses,
  onChanged,
  onError,
}: {
  departments: Department[];
  courses: CourseRow[];
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [rows, setRows] = useState<DueRow[]>([]);
  const [renewFor, setRenewFor] = useState<LicenseRow | null>(null);

  const load = useCallback(() => {
    api<DueRow[]>('/admin/renewals-due?days=7').then(setRows);
  }, []);
  useEffect(load, []);

  return (
    <div className="panel">
      <h3>未来 7 天内到期 / 已过期未处理的许可</h3>
      <p className="hint">续签不会延长旧许可，而是为该视频版本生成一条全新的许可记录。</p>
      {rows.length === 0 && <div className="hint">暂无需要续签的课程。</div>}
      <table className="grid">
        <thead>
          <tr>
            <th>课程 / 版本</th>
            <th>讲师</th>
            <th>授权部门</th>
            <th>截止日期</th>
            <th>剩余</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.version.course.title} · {r.version.versionLabel}
              </td>
              <td>{r.version.lecturer}</td>
              <td>{r.departments.map((d) => d.department.name).join('、')}</td>
              <td>{fmtDate(r.validUntil)}</td>
              <td>
                {r.overdue ? (
                  <span className="badge bad">已过期 {-r.daysLeft} 天</span>
                ) : (
                  <span className="badge warn">剩 {r.daysLeft} 天</span>
                )}
              </td>
              <td>
                <button onClick={() => setRenewFor(r)}>续签</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {renewFor && (
        <LicenseFormModal
          mode="renew"
          license={renewFor}
          departments={departments}
          courses={courses}
          lockVersion
          onClose={() => setRenewFor(null)}
          onDone={() => {
            setRenewFor(null);
            load();
            onChanged();
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

/* ---------------- 许可管理（筛选 + 登记 + 下架） ---------------- */

function LicensesTab({
  departments,
  courses,
  onChanged,
  onToast,
}: {
  departments: Department[];
  courses: CourseRow[];
  onChanged: () => void;
  onToast: (ok: boolean, msg: string) => void;
}) {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<LicenseRow[]>([]);
  const [showRegister, setShowRegister] = useState(false);
  const [renewFor, setRenewFor] = useState<LicenseRow | null>(null);
  const [revokeFor, setRevokeFor] = useState<LicenseRow | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(() => {
    api<LicenseRow[]>(`/admin/licenses${status ? `?status=${status}` : ''}`).then(setRows);
  }, [status]);
  useEffect(load, [status]);

  const doRevoke = async () => {
    try {
      await api(`/admin/licenses/${revokeFor!.id}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      onToast(true, '已下架，下架原因已留存');
      setRevokeFor(null);
      setReason('');
      load();
      onChanged();
    } catch (e) {
      onToast(false, (e as Error).message);
    }
  };

  return (
    <div className="panel">
      <div className="row-between">
        <h3>许可列表</h3>
        <div>
          <label>状态筛选：</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部</option>
            <option value="ACTIVE">生效中</option>
            <option value="SUPERSEDED">已续签替代</option>
            <option value="REVOKED">已下架</option>
          </select>{' '}
          <button className="primary" onClick={() => setShowRegister(true)}>
            登记新许可
          </button>
        </div>
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th>课程 / 版本</th>
            <th>许可文件</th>
            <th>部门</th>
            <th>有效期</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.version.course.title} · {r.version.versionLabel}
                <div className="hint">讲师：{r.version.lecturer}</div>
              </td>
              <td>
                <a href={`/api/admin/licenses/${r.id}/file`} target="_blank" rel="noreferrer">
                  {r.licenseFileName}
                </a>
              </td>
              <td>{r.departments.map((d) => d.department.name).join('、')}</td>
              <td>
                {fmtDate(r.validFrom)} ~ {fmtDate(r.validUntil)}
              </td>
              <td>
                <span
                  className={`badge ${
                    r.status === 'ACTIVE'
                      ? r.timeState === 'EXPIRED_PENDING'
                        ? 'bad'
                        : r.timeState === 'DUE_SOON'
                          ? 'warn'
                          : 'ok'
                      : 'muted'
                  }`}
                >
                  {STATUS_LABEL[r.status]}
                </span>
                {r.status === 'ACTIVE' && r.timeState === 'EXPIRED_PENDING' && (
                  <div className="bad">已到期待处理</div>
                )}
                {r.revokeReason && (
                  <div className="hint" title={r.revokeReason}>
                    下架原因：{r.revokeReason}
                  </div>
                )}
              </td>
              <td>
                {r.status === 'ACTIVE' && (
                  <>
                    <button onClick={() => setRenewFor(r)}>续签</button>{' '}
                    <button className="danger" onClick={() => setRevokeFor(r)}>
                      下架
                    </button>
                  </>
                )}
                {r.status !== 'ACTIVE' && <span className="hint">已归档</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showRegister && (
        <LicenseFormModal
          mode="register"
          departments={departments}
          courses={courses}
          onClose={() => setShowRegister(false)}
          onDone={() => {
            setShowRegister(false);
            load();
            onChanged();
            onToast(true, '许可登记成功');
          }}
          onError={(m) => onToast(false, m)}
        />
      )}
      {renewFor && (
        <LicenseFormModal
          mode="renew"
          license={renewFor}
          departments={departments}
          courses={courses}
          lockVersion
          onClose={() => setRenewFor(null)}
          onDone={() => {
            setRenewFor(null);
            load();
            onChanged();
            onToast(true, '续签成功：新记录已生成，旧许可已归档');
          }}
          onError={(m) => onToast(false, m)}
        />
      )}
      {revokeFor && (
        <Modal title={`下架许可：${revokeFor.version.course.title} · ${revokeFor.version.versionLabel}`}>
          <p className="hint">
            下架后员工立即无法播放/下载，此前拿到的旧链接也会失效；历史记录与下架原因将保留。
          </p>
          <label>下架原因（必填）</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          <div className="modal-actions">
            <button onClick={() => setRevokeFor(null)}>取消</button>
            <button className="danger" onClick={doRevoke} disabled={!reason.trim()}>
              确认下架
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- 许可登记/续签表单（多部件上传） ---------------- */

function LicenseFormModal({
  mode,
  license,
  departments,
  courses,
  lockVersion,
  onClose,
  onDone,
  onError,
}: {
  mode: 'register' | 'renew';
  license?: LicenseRow | null;
  departments: Department[];
  courses: CourseRow[];
  lockVersion?: boolean;
  onClose: () => void;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [versionId, setVersionId] = useState(license?.versionId ?? '');
  const [deptIds, setDeptIds] = useState<string[]>(
    license ? license.departments.map((d) => d.department.id) : [],
  );
  const today = new Date();
  const [validFrom, setValidFrom] = useState(toDateInput(today));
  const [validUntil, setValidUntil] = useState(
    toDateInput(new Date(today.getTime() + 365 * 86400000)),
  );
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 课程分组下所有版本
  const allVersions = courses.flatMap((c) =>
    c.versions.map((v) => ({
      versionId: v.id,
      label: `${c.title} / ${v.versionLabel}（${v.lecturer}）`,
    })),
  );

  const toggleDept = (id: string) =>
    setDeptIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submit = async () => {
    if (!versionId) return onError('请选择视频版本');
    if (!file) return onError(mode === 'renew' ? '续签必须上传新的许可文件' : '请上传许可文件');
    if (deptIds.length === 0) return onError('请至少选择一个可观看部门');
    if (!validFrom || !validUntil) return onError('请填写有效期');

    const fd = new FormData();
    fd.append('versionId', versionId);
    fd.append('licenseFile', file);
    fd.append('departmentIds', JSON.stringify(deptIds));
    fd.append('validFrom', new Date(validFrom).toISOString());
    fd.append('validUntil', new Date(validUntil).toISOString());
    fd.append('note', note);
    setSubmitting(true);
    try {
      await api(mode === 'renew' ? '/admin/licenses/renew' : '/admin/licenses', {
        method: 'POST',
        body: fd,
      });
      onDone();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={mode === 'renew' ? '续签许可（生成新记录）' : '登记许可'}>
      <label>视频版本（续签必须对应原版本）</label>
      {lockVersion ? (
        <div className="readonly">
          {license?.version.course.title} · {license?.version.versionLabel}
        </div>
      ) : (
        <select value={versionId} onChange={(e) => setVersionId(e.target.value)}>
          <option value="">请选择…</option>
          {allVersions.map((v) => (
            <option key={v.versionId} value={v.versionId}>
              {v.label}
            </option>
          ))}
        </select>
      )}

      <label>许可文件{mode === 'renew' ? '（新文件，旧许可文件保留不删）' : ''}</label>
      <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />

      <label>可观看部门（可多选）</label>
      <div className="dept-pick">
        {departments.map((d) => (
          <label key={d.id} className="chip">
            <input
              type="checkbox"
              checked={deptIds.includes(d.id)}
              onChange={() => toggleDept(d.id)}
            />
            {d.name}
          </label>
        ))}
      </div>

      <div className="form-row">
        <div>
          <label>生效日期</label>
          <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </div>
        <div>
          <label>截止日期</label>
          <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </div>
      </div>

      <label>备注</label>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选" />

      <div className="modal-actions">
        <button onClick={onClose} disabled={submitting}>
          取消
        </button>
        <button className="primary" onClick={submit} disabled={submitting}>
          {submitting ? '提交中…' : mode === 'renew' ? '确认续签（不修改旧记录）' : '登记'}
        </button>
      </div>
    </Modal>
  );
}

/* ---------------- 课程与版本 / 授权历史 ---------------- */

function CoursesTab({
  courses,
  onChanged,
  onToast,
}: {
  courses: CourseRow[];
  onChanged: () => void;
  onToast: (ok: boolean, msg: string) => void;
}) {
  const [historyFor, setHistoryFor] = useState<{ title: string; versionId: string } | null>(null);
  const [history, setHistory] = useState<LicenseRow[] | null>(null);

  const openHistory = async (title: string, versionId: string) => {
    setHistoryFor({ title, versionId });
    setHistory(await api<LicenseRow[]>(`/admin/versions/${versionId}/license-history`));
  };

  return (
    <div>
      {courses.map((c) => (
        <div key={c.id} className="panel">
          <h3>{c.title}</h3>
          <p className="hint">{c.description}</p>
          <table className="grid">
            <thead>
              <tr>
                <th>版本</th>
                <th>讲师</th>
                <th>视频文件</th>
                <th>许可数</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {c.versions.map((v) => (
                <tr key={v.id}>
                  <td>{v.versionLabel}</td>
                  <td>{v.lecturer}</td>
                  <td className="hint">{v.fileName}</td>
                  <td>{v.licenses.length}</td>
                  <td>
                    <button onClick={() => openHistory(`${c.title} · ${v.versionLabel}`, v.id)}>
                      授权历史
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {historyFor && (
        <Modal title={`授权历史：${historyFor.title}`}>
          {history === null ? (
            <div>加载中…</div>
          ) : history.length === 0 ? (
            <div className="hint">该版本尚无许可记录。</div>
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th>许可文件</th>
                  <th>部门</th>
                  <th>有效期</th>
                  <th>状态 / 原因</th>
                  <th>登记时间</th>
                </tr>
              </thead>
              <tbody>
                {history.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <a href={`/api/admin/licenses/${l.id}/file`} target="_blank" rel="noreferrer">
                        {l.licenseFileName}
                      </a>
                    </td>
                    <td>{l.departments.map((d) => d.department.name).join('、')}</td>
                    <td>
                      {fmtDate(l.validFrom)} ~ {fmtDate(l.validUntil)}
                    </td>
                    <td>
                      <span className="badge muted">{STATUS_LABEL[l.status]}</span>
                      {l.revokeReason && <div className="hint">{l.revokeReason}</div>}
                      {l.note && <div className="hint">备注：{l.note}</div>}
                    </td>
                    <td>{fmtDateTime(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="modal-actions">
            <button onClick={() => setHistoryFor(null)}>关闭</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- 访问记录 ---------------- */

function AccessLogsTab({ courses }: { courses: CourseRow[] }) {
  const [versionFilter, setVersionFilter] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [rows, setRows] = useState<AccessLogRow[]>([]);

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (versionFilter) q.set('versionId', versionFilter);
    if (resultFilter) q.set('result', resultFilter);
    q.set('limit', '300');
    api<AccessLogRow[]>(`/admin/access-logs?${q.toString()}`).then(setRows);
  }, [versionFilter, resultFilter]);
  useEffect(load, [load]);

  const allVersions = courses.flatMap((c) =>
    c.versions.map((v) => ({ id: v.id, label: `${c.title} / ${v.versionLabel}` })),
  );

  return (
    <div className="panel">
      <div className="row-between">
        <h3>访问记录（含被拒绝的越权/到期/旧链接请求）</h3>
        <div>
          <select value={versionFilter} onChange={(e) => setVersionFilter(e.target.value)}>
            <option value="">全部版本</option>
            {allVersions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>{' '}
          <select value={resultFilter} onChange={(e) => setResultFilter(e.target.value)}>
            <option value="">全部结果</option>
            <option value="GRANTED">已放行</option>
            <option value="DENIED">已拒绝</option>
          </select>{' '}
          <button onClick={load}>刷新</button>
        </div>
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th>时间</th>
            <th>员工</th>
            <th>课程版本</th>
            <th>动作</th>
            <th>结果</th>
            <th>原因</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{fmtDateTime(r.createdAt)}</td>
              <td>
                {r.user ? `${r.user.name}（${r.user.department.name}）` : <span className="hint">未知/失效用户</span>}
              </td>
              <td>
                {r.version
                  ? `${r.version.course.title} / ${r.version.versionLabel}`
                  : <span className="hint">{r.reason?.includes('v=') ? '篡改参数' : '版本已删'}</span>}
              </td>
              <td>{r.action}</td>
              <td>
                <span className={`badge ${r.result === 'GRANTED' ? 'ok' : 'bad'}`}>
                  {r.result === 'GRANTED' ? '放行' : '拒绝'}
                </span>
              </td>
              <td className="hint">{r.reason}</td>
              <td>{r.ip ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- 模拟提醒 ---------------- */

function RemindersTab() {
  const [rows, setRows] = useState<ReminderRow[]>([]);
  const [scanResult, setScanResult] = useState<string>('');

  const load = useCallback(() => {
    api<ReminderRow[]>('/admin/reminders').then(setRows);
  }, []);
  useEffect(load, []);

  const scan = async () => {
    const r = await api<{ scanned: number; sent: number }>('/admin/reminders/scan?days=7', {
      method: 'POST',
    });
    setScanResult(`扫描完成：命中 ${r.scanned} 条临期许可，本次新生成 ${r.sent} 条模拟提醒`);
    load();
  };

  return (
    <div className="panel">
      <div className="row-between">
        <h3>模拟提醒（不真正发送邮件，内容落库可回查）</h3>
        <button className="primary" onClick={scan}>
          立即扫描未来 7 天到期许可
        </button>
      </div>
      {scanResult && <div className="toast ok">{scanResult}</div>}
      <table className="grid">
        <thead>
          <tr>
            <th>发送时间</th>
            <th>渠道</th>
            <th>课程版本</th>
            <th>提醒内容</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{fmtDateTime(r.sentAt)}</td>
              <td>{r.channel}</td>
              <td>
                {r.license.version.course.title} · {r.license.version.versionLabel}
              </td>
              <td>{r.content}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- 通用小组件 ---------------- */

function Modal({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="modal-mask">
      <div className="modal wide">
        <div className="modal-head">
          <b>{title}</b>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
