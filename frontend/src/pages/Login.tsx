import { useEffect, useState } from 'react';
import { login } from '../api';
import type { UserInfo } from '../types';

interface PickUser {
  id: string;
  account: string;
  name: string;
  role: 'ADMIN' | 'EMPLOYEE';
  department: { name: string };
}

export default function Login({ onLoggedIn }: { onLoggedIn: (u: UserInfo) => void }) {
  const [account, setAccount] = useState('alice');
  const [password, setPassword] = useState('123456');
  const [error, setError] = useState('');
  const [users, setUsers] = useState<PickUser[]>([]);

  useEffect(() => {
    fetch('/api/auth/users').then((r) => r.json()).then(setUsers).catch(() => {});
  }, []);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');
    try {
      onLoggedIn(await login(account, password));
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="login-wrap">
      <form className="panel" onSubmit={submit}>
        <h2>培训录播系统登录</h2>
        <div className="field">
          <label>账号</label>
          <input value={account} onChange={(e) => setAccount(e.target.value)} />
        </div>
        <div className="field">
          <label>密码（演示环境统一 123456）</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn" style={{ width: '100%' }}>登录</button>

        <div className="muted" style={{ margin: '16px 0 6px' }}>快速选择演示账号：</div>
        <div className="user-pick">
          {users.map((u) => (
            <button
              type="button"
              key={u.id}
              onClick={() => { setAccount(u.account); setPassword('123456'); }}
            >
              <b>{u.name}</b> · {u.department.name}
              <span className="role">{u.role === 'ADMIN' ? '管理员' : '员工'} · {u.account}</span>
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
