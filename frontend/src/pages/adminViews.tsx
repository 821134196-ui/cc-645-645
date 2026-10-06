import { useCallback, useEffect, useState } from 'react';
import { apiClient, api as apiRaw } from '../api';
import type { LicenseView } from '../types';
import { fmtDateTime } from '../format';

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: '授权有效',
  EXPIRING_SOON: '即将到期',
  EXPIRED: '已到期',
  TAKEN_DOWN: '已下架',
  RENEWED: '已续签',
};

export function StatusBadge({ s }: { s: string }) {
  return <span className={`badge ${s}`}>{STATUS_LABELS[s] || s}</span>;
}

/** 续签提醒页：未来一周需要续签 + 触发模拟扫描 + 发起续签 */
export function RenewDue({ onRenew }: { onRenew: (l: LicenseView) => void }) {
  const [items, setItems] = useState<LicenseView[]>([]);
  const [scanMsg, setScanMsg] = useState('');

  const load = useCallback(() => {
    apiClient.renewDue().then(setItems);
  }, []);
  useEffect(load, []);

  const scan = async () => {
    const r = await apiClient.scanNotifications();
    setScanMsg(`扫描完成：发现 ${r.dueCount} 条未来 7 天内到期的授权，模拟提醒已生成（见“模拟通知”页与后端日志）。`);
  };

  return (
    <div className="panel">
      <h2>未来一周需要续签的课程</h2>
      <div className="sub">授权在 {`{RENEW_WINDOW_DAYS=7}`} 天内到期且仍有效的许可会列在这里。续签必须选择新视频版本并登记新的许可文件，旧许可不会被改期。</div>
      <div style={{ marginBottom: 14 }}>
        <button className="btn ghost" onClick={scan}>立即扫描并发送模拟提醒</button>
        {scanMsg && <span className="muted" style={{ marginLeft: 12 }}>{scanMsg}</span>}
      </div>
      {items.length === 0 && <div className="banner">未来一周暂无需要续签的授权。</div>}
      <table>
        <thead>
          <tr>
            <th>课程 / 版本</th><th>可观看部门</th><th>到期时间</th><th>剩余</th><th>许可文件</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((l) => (
            <tr key={l.id}>
              <td><b>{l.courseTitle}</b><div className="muted">版本 {l.versionLabel}</div></td>
              <td className="dept-tags">{l.departments.map((d) => <span key={d.id}>{d.name}</span>)}</td>
              <td>{fmtDateTime(l.validUntil)}</td>
              <td><span className="badge EXPIRING_SOON">{l.daysLeft} 天</span></td>
              <td className="muted">{l.licenseFileName}</td>
              <td>
                <button className="btn sm" onClick={() => onRenew(l)}>续签</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 授权管理：按状态筛选 + 登记新授权 + 续签 + 下架 */
export function Licenses({
  view, onRenew, reloadKey, onChanged,
}: {
  view: 'renew' | 'licenses';
  onRenew: (l: LicenseView) => void;
  reloadKey: number;
  onChanged: () => void;
}) {
  const FILTERS = ['ALL', 'ACTIVE', 'EXPIRING_SOON', 'EXPIRED', 'TAKEN_DOWN', 'RENEWED'] as const;
  const [filter, setFilter] = useState<string>('ALL');
  const [items, setItems] = useState<LicenseView[]>([]);
  const [takedown, setTakedown] = useState<LicenseView | null>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    apiClient.licenses(filter).then(setItems).catch((e) => setErr(e.message));
  }, [filter, reloadKey]);
  useEffect(load, [load]);

  const doTakeDown = async () => {
    setErr('');
    try {
      await apiClient.takeDown(takedown!.id, reason);
      setTakedown(null); setReason('');
      onChanged();
    } catch (e: any) { setErr(e.message); }
  };

  if (view === 'renew') return null;

  return (
    <div className="panel">
      <h2>授权管理</h2>
      <div className="sub">按授权状态筛选；下架需填写原因，历史授权与下架原因永久保留。</div>
      {err && <div className="error">{err}</div>}
      <div className="filters">
        {FILTERS.map((f) => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {f === 'ALL' ? '全部' : STATUS_LABELS[f]}
          </button>
        ))}
      </div>
      <table>
        <thead>
          <tr>
            <th>课程 / 版本</th><th>状态</th><th>可观看部门</th><th>授权期限</th>
            <th>许可文件</th><th>续签关系</th><th style={{ width: 160 }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((l) => (
            <tr key={l.id}>
              <td><b>{l.courseTitle}</b><div className="muted">版本 {l.versionLabel}</div></td>
              <td><StatusBadge s={l.effectiveStatus} /></td>
              <td className="dept-tags">{l.departments.map((d) => <span key={d.id}>{d.name}</span>)}</td>
              <td>{fmtDateTime(l.validFrom)}<br />至 {fmtDateTime(l.validUntil)}</td>
              <td>
                <a href={apiClient.licenseFileUrl(l.id)} target="_blank" rel="noreferrer">{l.licenseFileName}</a>
                {l.takeDownReason && (
                  <div className="muted" style={{ color: '#b91c1c' }}>
                    下架：{l.takeDownReason}
                    {l.takenDownAt ? `（${fmtDateTime(l.takenDownAt)}）` : ''}
                  </div>
                )}
              </td>
              <td className="muted">
                {l.supersededById ? `已被新版本 ${l.supersededByVersion} 的许可接替` : '—'}
              </td>
              <td>
                {l.effectiveStatus !== 'TAKEN_DOWN' && l.effectiveStatus !== 'RENEWED' && (
                  <>
                    <button className="btn sm" onClick={() => onRenew(l)}>续签</button>{' '}
                    <button className="btn sm danger" onClick={() => { setTakedown(l); setReason(''); }}>下架</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {takedown && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setTakedown(null)}>
          <div className="modal">
            <h3>下架《{takedown.courseTitle}》{takedown.versionLabel}</h3>
            <div className="banner">下架后，员工此前获取的播放/下载地址将立即失效，且下架原因会保留在历史中。</div>
            <div className="field">
              <label>下架原因（必填）</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：许可方要求停止使用" />
            </div>
            <div className="actions">
              <button className="btn ghost" onClick={() => setTakedown(null)}>取消</button>
              <button className="btn danger" disabled={!reason.trim()} onClick={doTakeDown}>确认下架</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 历史授权：按课程查看完整许可链 */
export function History({ reloadKey }: { reloadKey: number }) {
  const [courses, setCourses] = useState<any[]>([]);
  const [courseId, setCourseId] = useState('');
  const [items, setItems] = useState<LicenseView[]>([]);

  useEffect(() => {
    apiClient.coursesVersions().then((cs) => {
      setCourses(cs);
      if (!courseId && cs.length) setCourseId(cs[0].id);
    });
  }, [reloadKey]);

  useEffect(() => {
    if (courseId) apiClient.history(courseId).then(setItems);
  }, [courseId, reloadKey]);

  return (
    <div className="panel">
      <h2>历史授权回查</h2>
      <div className="sub">展示一门课程下所有版本的许可记录：包括已到期、已续签（保留接替链）与已下架（保留原因）的记录。</div>
      <div className="field" style={{ maxWidth: 360 }}>
        <label>选择课程</label>
        <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </div>
      <table>
        <thead>
          <tr><th>版本</th><th>状态</th><th>授权期限</th><th>部门</th><th>许可文件</th><th>接替关系 / 下架原因</th><th>登记时间</th></tr>
        </thead>
        <tbody>
          {items.map((l) => (
            <tr key={l.id}>
              <td>{l.versionLabel}</td>
              <td><StatusBadge s={l.effectiveStatus} /></td>
              <td>{fmtDateTime(l.validFrom)} 至 {fmtDateTime(l.validUntil)}</td>
              <td className="dept-tags">{l.departments.map((d) => <span key={d.id}>{d.name}</span>)}</td>
              <td><a href={apiClient.licenseFileUrl(l.id)} target="_blank" rel="noreferrer">{l.licenseFileName}</a></td>
              <td className="muted">
                {l.supersededById ? `被新版本 ${l.supersededByVersion} 接替` : ''}
                {l.takeDownReason ? `下架：${l.takeDownReason}` : ''}
              </td>
              <td className="muted">{fmtDateTime(l.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 访问记录：允许/拒绝尝试全部留痕 */
export function AccessLogs() {
  const [result, setResult] = useState('');
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    apiClient.accessLogs(result).then(setItems);
  }, [result]);

  const reasonText: Record<string, string> = {
    EXPIRED: '授权到期', TAKEN_DOWN: '已下架', DEPARTMENT_MISMATCH: '跨部门越权',
    NO_LICENSE: '无授权', BAD_SIGNATURE: '签名无效/被篡改', LINK_EXPIRED: '签名地址超时',
    USER_MISMATCH: '非签名本人', MODE_MISMATCH: '播放/下载用途不符', RENEWED: '许可已续签',
  };

  return (
    <div className="panel">
      <h2>访问记录回查</h2>
      <div className="sub">员工每次播放、下载（含被拒绝的尝试）都会记录原因，便于审计越权访问与到期访问。</div>
      <div className="filters">
        {['', 'ALLOWED', 'DENIED'].map((r) => (
          <button key={r} className={result === r ? 'active' : ''} onClick={() => setResult(r)}>
            {r === '' ? '全部' : r === 'ALLOWED' ? '放行' : '拒绝'}
          </button>
        ))}
      </div>
      <table>
        <thead>
          <tr><th>时间</th><th>员工</th><th>课程 / 版本</th><th>方式</th><th>结果</th><th>原因</th></tr>
        </thead>
        <tbody>
          {items.map((x) => (
            <tr key={x.id}>
              <td className="muted">{fmtDateTime(x.createdAt)}</td>
              <td>{x.user?.name}<div className="muted">{x.user?.department?.name}</div></td>
              <td>{x.version?.course?.title}<div className="muted">{x.version?.versionLabel}</div></td>
              <td>{x.mode === 'STREAM' ? '播放' : '下载'}</td>
              <td>
                <span className={`badge ${x.result === 'ALLOWED' ? 'ACTIVE' : 'TAKEN_DOWN'}`}>
                  {x.result === 'ALLOWED' ? '放行' : '拒绝'}
                </span>
              </td>
              <td className="muted">{x.reason ? reasonText[x.reason] || x.reason : '—'}</td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={6} className="muted">暂无记录</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** 模拟通知 */
export function Notify() {
  const [items, setItems] = useState<any[]>([]);
  const load = () => { apiClient.notifications().then(setItems); };
  useEffect(load, []);

  return (
    <div className="panel">
      <h2>续签提醒（模拟实现）</h2>
      <div className="sub">真实环境可替换为邮件/企业 IM；当前实现把提醒落库并打印到后端控制台日志。</div>
      <button className="btn ghost" onClick={async () => { await apiClient.scanNotifications(); load(); }}>
        重新扫描生成提醒
      </button>
      <table style={{ marginTop: 12 }}>
        <thead><tr><th>生成时间</th><th>提醒内容</th><th>状态</th></tr></thead>
        <tbody>
          {items.map((n) => (
            <tr key={n.id}>
              <td className="muted">{fmtDateTime(n.createdAt)}</td>
              <td>{n.message}</td>
              <td><span className={`badge ${n.sent ? 'RENEWED' : 'EXPIRING_SOON'}`}>{n.sent ? '已处理' : '待处理'}</span></td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={3} className="muted">暂无提醒，可点击上方按钮扫描</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
