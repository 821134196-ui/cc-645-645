import { useState } from 'react';
import { currentUser, login, tokenStore } from './api';
import type { UserInfo } from './types';
import Login from './pages/Login';
import EmployeeCourses from './pages/EmployeeCourses';
import AdminConsole from './pages/AdminConsole';

type Tab = 'employee' | 'renew' | 'licenses' | 'history' | 'logs' | 'notify';

const TABS: { key: Tab; label: string; adminOnly?: boolean }[] = [
  { key: 'employee', label: '我的课程' },
  { key: 'renew', label: '续签提醒', adminOnly: true },
  { key: 'licenses', label: '授权管理', adminOnly: true },
  { key: 'history', label: '历史授权', adminOnly: true },
  { key: 'logs', label: '访问记录', adminOnly: true },
  { key: 'notify', label: '模拟通知', adminOnly: true },
];

export default function App() {
  const [user, setUser] = useState<UserInfo | null>(() => currentUser());
  const [tab, setTab] = useState<Tab>('employee');

  if (!user || !tokenStore.get()) {
    return <Login onLoggedIn={(u) => { setUser(u); setTab(u.role === 'ADMIN' ? 'renew' : 'employee'); }} />;
  }

  const logout = () => {
    tokenStore.clear();
    setUser(null);
  };

  const visibleTabs = TABS.filter((t) => !t.adminOnly || user.role === 'ADMIN');

  return (
    <div>
      <header className="app-header">
        <h1>企业培训录播授权系统</h1>
        <div className="tabs">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? 'active' : ''}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <span className="who">
          {user.name}（{user.role === 'ADMIN' ? '管理员' : '员工'} · {user.department.name}）
        </span>
        <button onClick={logout}>退出登录</button>
      </header>

      <main className="container">
        {tab === 'employee' && <EmployeeCourses />}
        {tab === 'renew' && <AdminConsole view="renew" />}
        {tab === 'licenses' && <AdminConsole view="licenses" />}
        {tab === 'history' && <AdminConsole view="history" />}
        {tab === 'logs' && <AdminConsole view="logs" />}
        {tab === 'notify' && <AdminConsole view="notify" />}
      </main>
    </div>
  );
}
