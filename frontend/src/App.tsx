import { useEffect, useState } from 'react';
import { EmployeePage } from './employee/EmployeePage';
import { AdminPage } from './admin/AdminPage';
import { api, setCurrentUser } from './api';

interface UserOption {
  id: string;
  name: string;
  employeeNo: string;
  role: string;
  department: { name: string };
}

// 从员工端接口反查用户列表：直接由课程接口获取不到，这里用轻量种子用户清单接口
async function loadUsers(): Promise<UserOption[]> {
  return api<UserOption[]>('/users');
}

export default function App() {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [userId, setUserId] = useState('');
  const [view, setView] = useState<'employee' | 'admin'>('employee');

  useEffect(() => {
    loadUsers()
      .then((list) => {
        setUsers(list);
        const saved = localStorage.getItem('userId');
        const first = saved && list.some((u) => u.id === saved) ? saved : list[0]?.id ?? '';
        setUserId(first);
        setCurrentUser(first);
      })
      .catch(() => undefined);
  }, []);

  const switchUser = (id: string) => {
    setUserId(id);
    setCurrentUser(id);
    localStorage.setItem('userId', id);
  };

  return (
    <div>
      <header className="topbar">
        <div className="brand">企业培训录播授权系统</div>
        <nav>
          <button className={view === 'employee' ? 'navbtn active' : 'navbtn'} onClick={() => setView('employee')}>
            员工端
          </button>
          <button className={view === 'admin' ? 'navbtn active' : 'navbtn'} onClick={() => setView('admin')}>
            管理端
          </button>
        </nav>
        <div className="userpick">
          当前身份：
          <select value={userId} onChange={(e) => switchUser(e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}（{u.department.name}
                {u.role === 'ADMIN' ? '·管理员' : ''}）
              </option>
            ))}
          </select>
        </div>
      </header>
      <main className="content">
        {/* 切换身份/视图时强制重挂载，避免看到上一个人的数据 */}
        {view === 'employee' ? <EmployeePage key={'e' + userId} /> : <AdminPage key="admin" />}
      </main>
    </div>
  );
}
