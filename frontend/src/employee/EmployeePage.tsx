import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api';

interface EmployeeData {
  employee: { id: string; name: string; department: string };
  courses: Array<{
    courseId: string;
    title: string;
    description: string | null;
    versions: Array<{
      versionId: string;
      versionLabel: string;
      lecturer: string;
      durationSec: number | null;
      status: 'AVAILABLE' | 'EXPIRED' | 'REVOKED' | 'UNAVAILABLE';
      validUntil: string;
      daysLeft: number;
    }>;
  }>;
}

const STATUS_META: Record<string, { text: string; cls: string }> = {
  AVAILABLE: { text: '可观看', cls: 'ok' },
  EXPIRED: { text: '已到期', cls: 'bad' },
  REVOKED: { text: '已下架', cls: 'bad' },
  UNAVAILABLE: { text: '暂不可用', cls: 'warn' },
};

export function EmployeePage() {
  const [data, setData] = useState<EmployeeData | null>(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState<{
    title: string;
    versionLabel: string;
    url: string;
  } | null>(null);
  const [busy, setBusy] = useState('');

  const load = () => {
    api<EmployeeData>('/me/courses')
      .then(setData)
      .catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const openVideo = async (
    title: string,
    versionLabel: string,
    versionId: string,
    action: 'play' | 'download',
  ) => {
    setBusy(versionId + action);
    setError('');
    try {
      const r = await api<{ url: string }>('/media/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId, action }),
      });
      if (action === 'download') {
        window.location.href = r.url;
      } else {
        setPlaying({ title, versionLabel, url: r.url });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  if (!data) return <div className="panel">加载中…{error && <b className="bad">{error}</b>}</div>;

  return (
    <div>
      <div className="panel employee-head">
        <div>
          <b>{data.employee.name}</b>（{data.employee.department}）的课程列表
        </div>
        <div className="hint">
          播放与下载地址由服务端实时鉴权后签发，有效期 10 分钟；授权一旦到期或下架，旧地址立即失效。
        </div>
      </div>
      {error && <div className="toast bad">{error}</div>}

      {playing && (
        <div className="modal-mask" onClick={() => setPlaying(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <b>
                {playing.title} · {playing.versionLabel}
              </b>
              <button onClick={() => setPlaying(null)}>关闭</button>
            </div>
            <video src={playing.url} controls autoPlay className="player" />
          </div>
        </div>
      )}

      {data.courses.length === 0 && <div className="panel">暂无授权给您所在部门的课程。</div>}
      {data.courses.map((c) => (
        <div key={c.courseId} className="panel course-card">
          <h3>{c.title}</h3>
          <p className="hint">{c.description}</p>
          <table className="grid">
            <thead>
              <tr>
                <th>版本</th>
                <th>讲师</th>
                <th>状态</th>
                <th>授权截止</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {c.versions.map((v) => {
                const meta = STATUS_META[v.status];
                return (
                  <tr key={v.versionId}>
                    <td>{v.versionLabel}</td>
                    <td>{v.lecturer}</td>
                    <td>
                      <span className={`badge ${meta.cls}`}>{meta.text}</span>
                      {v.status === 'AVAILABLE' && v.daysLeft <= 7 && (
                        <span className="warn">（剩 {v.daysLeft} 天）</span>
                      )}
                    </td>
                    <td>{fmtDate(v.validUntil)}</td>
                    <td>
                      <button
                        disabled={v.status !== 'AVAILABLE' || !!busy}
                        onClick={() => openVideo(c.title, v.versionLabel, v.versionId, 'play')}
                      >
                        {busy === v.versionId + 'play' ? '鉴权中…' : '播放'}
                      </button>{' '}
                      <button
                        disabled={v.status !== 'AVAILABLE' || !!busy}
                        onClick={() => openVideo(c.title, v.versionLabel, v.versionId, 'download')}
                      >
                        下载
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
