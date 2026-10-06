import { useEffect, useState } from 'react';
import { apiClient, mediaUrl } from '../api';
import type { CourseView, CourseVersionView } from '../types';
import { fmtDateTime } from '../format';

export default function EmployeeCourses() {
  const [courses, setCourses] = useState<CourseView[]>([]);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState<{ title: string; label: string; url: string } | null>(null);
  const [busy, setBusy] = useState('');

  const load = () => {
    setError('');
    apiClient.myCourses().then(setCourses).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const open = async (course: CourseView, v: CourseVersionView, mode: 'STREAM' | 'DOWNLOAD') => {
    setBusy(v.id + mode);
    setError('');
    try {
      // 每次打开都由服务端重新鉴权并签发短时效地址
      const acc = await apiClient.requestAccess(v.id, mode);
      if (mode === 'DOWNLOAD') {
        window.location.href = mediaUrl(acc.url);
      } else {
        setPlaying({ title: course.title, label: v.versionLabel, url: mediaUrl(acc.url) });
      }
    } catch (e: any) {
      setError(`《${course.title}》${v.versionLabel}：${e.message}`);
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <div className="panel">
        <h2>我的课程</h2>
        <div className="sub">能否观看取决于您所在部门的授权及具体视频版本的授权期限。播放地址为短时效签名地址，授权到期或视频下架后立即失效。</div>
        {error && <div className="error">{error}</div>}
        <table>
          <thead>
            <tr>
              <th style={{ width: 200 }}>课程 / 版本</th>
              <th style={{ width: 120 }}>授权状态</th>
              <th style={{ width: 170 }}>授权到期时间</th>
              <th>说明</th>
              <th style={{ width: 180 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {courses.flatMap((c) =>
              c.versions.map((v, i) => (
                <tr key={v.id}>
                  <td>
                    {i === 0 && <div className="course-title">{c.title}</div>}
                    <span className={i === 0 ? 'muted' : ''}>版本 {v.versionLabel}</span>
                  </td>
                  <td><span className={`badge ${v.status}`}>{v.statusText}</span></td>
                  <td>{fmtDateTime(v.validUntil)}</td>
                  <td className="muted">
                    {v.takeDownReason
                      ? `下架原因：${v.takeDownReason}`
                      : !v.deptGranted && v.status !== 'NO_LICENSE'
                        ? '您所在部门不在授权范围'
                        : v.status === 'EXPIRING_SOON' ? '授权即将到期，请留意管理员续签' : ''}
                  </td>
                  <td>
                    <button
                      className="btn sm"
                      disabled={!v.playable || !!busy}
                      onClick={() => open(c, v, 'STREAM')}
                      title={v.playable ? '' : '当前无权播放'}
                    >
                      {busy === v.id + 'STREAM' ? '鉴权中…' : '播放'}
                    </button>{' '}
                    <button
                      className="btn sm ghost"
                      disabled={!v.playable || !!busy}
                      onClick={() => open(c, v, 'DOWNLOAD')}
                    >
                      下载
                    </button>
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>

      {playing && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setPlaying(null)}>
          <div className="modal" style={{ width: 720 }}>
            <h3>{playing.title} · 版本 {playing.label}</h3>
            <video
              className="video-player"
              src={playing.url}
              controls
              autoPlay
              onError={() => setError('播放失败：链接可能已失效，请关闭后重新进入（服务端会再次鉴权）')}
            />
            <div className="actions">
              <button className="btn ghost" onClick={() => setPlaying(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
