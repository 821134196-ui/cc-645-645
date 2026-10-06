/**
 * 端到端流程验证（不依赖测试框架，Node 22 内置 fetch）。
 * 前置：后端已启动在 BASE；数据库已执行 seed。
 *
 * 覆盖：
 *  1. 到期前拿到的播放/下载地址，授权到期后立即失效（签名本身未过期）
 *  2. 跨部门员工访问 / 盗用他人签名链接 → 403
 *  3. 版本续签生成新许可记录、旧许可不被改期、旧链接失效、新版本可看
 *  4. 下架（原因保留）后旧链接失效
 *  5. 续签提醒列表与模拟通知随状态变化
 *  6. 历史授权链与访问记录完整保留
 */

const BASE = process.env.BASE || 'http://localhost:3001/api';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: any) {
  if (cond) {
    pass++;
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
  } else {
    fail++;
    console.log(`  \x1b[31m�“✗ ${name}\x1b[0m`, extra ?? '');
  }
}
async function json(res: Response) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function login(account: string) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password: '123456' }),
  });
  const data = await json(res);
  return { token: data.token as string, user: data.user, setAuth: () => ({ Authorization: `Bearer ${data.token}` }) };
}

function delay(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log('\n=== 登录 ===');
  const admin = await login('admin');
  const alice = await login('alice'); // 研发部
  const bob = await login('bob');     // 销售部
  const carol = await login('carol'); // 人事部
  ok('管理员/员工均可登录', !!admin.token && !!alice.token && !!bob.token && !!carol.token);

  // 找到种子课程与版本
  const cv = await (await fetch(`${BASE}/admin/courses-versions`, { headers: admin.setAuth() })).json();
  const safety = cv.find((c: any) => c.title === '安全生产培训');
  const sales = cv.find((c: any) => c.title === '销售技巧精讲');
  const onboard = cv.find((c: any) => c.title === '入职合规指引');
  const v1 = safety.versions.find((x: any) => x.versionLabel === 'v1');
  const v2 = safety.versions.find((x: any) => x.versionLabel === 'v2');
  const salesV1 = sales.versions[0];
  const onboardV1 = onboard.versions[0];

  console.log('\n=== 1. 员工列表展示到期时间与状态 ===');
  const mine = await (await fetch(`${BASE}/courses/mine`, { headers: alice.setAuth() })).json();
  const safetyEntry = mine.find((c: any) => c.id === safety.id);
  const v2Entry = safetyEntry.versions.find((x: any) => x.id === v2.id);
  const v1Entry = safetyEntry.versions.find((x: any) => x.id === v1.id);
  ok('v2 显示“即将到期”且有截止时间', v2Entry.status === 'EXPIRING_SOON' && !!v2Entry.validUntil);
  ok('v1 显示“已到期”不可播放', v1Entry.status === 'EXPIRED' && v1Entry.playable === false);

  console.log('\n=== 2. 已到期版本：打开视频被服务端拒绝 ===');
  const expiredAccess = await fetch(`${BASE}/courses/${v1.id}/access?mode=STREAM`, {
    method: 'POST', headers: alice.setAuth(),
  });
  const expiredBody = await json(expiredAccess);
  ok('到期版本请求播放 → 403 EXPIRED', expiredAccess.status === 403 && expiredBody.message?.includes('到期'));

  console.log('\n=== 3. 跨部门访问被拒（销售部访问研发部课程） ===');
  const cross = await fetch(`${BASE}/courses/${v2.id}/access?mode=STREAM`, {
    method: 'POST', headers: bob.setAuth(),
  });
  const crossBody = await json(cross);
  ok('跨部门请求播放 → 403 DEPARTMENT_MISMATCH', cross.status === 403 && crossBody.message.includes('部门'));

  console.log('\n=== 4. 动态场景：先拿到地址，授权到期后旧地址立即失效 ===');
  // 4.1 管理员新建课程 + 两个版本
  const dynCourse = await (await fetch(`${BASE}/admin/courses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({ title: 'E2E临时课程-到期验证' }),
  })).json();
  const depts = await (await fetch(`${BASE}/admin/departments`, { headers: admin.setAuth() })).json();
  const engDept = depts.find((d: any) => d.name === '研发部').id;

  const upload = async (field: string, filename: string) => {
    const fd = new FormData();
    fd.append(field, new Blob([Buffer.alloc(4096, 0)]), filename);
    return fd;
  };
  const fdV1 = await upload('video', 'dyn-v1.mp4');
  fdV1.append('courseId', dynCourse.id);
  fdV1.append('versionLabel', 'v1');
  const dynV1 = await (await fetch(`${BASE}/admin/versions`, { method: 'POST', headers: admin.setAuth(), body: fdV1 })).json();
  ok('管理员上传新版本视频', !!dynV1.id);

  // 4.2 签发一个 4 秒后到期的许可（带许可文件）
  const now = Date.now();
  const licFd = new FormData();
  licFd.append('licenseFile', new Blob([Buffer.from('临时许可')]), 'temp-license.pdf');
  licFd.append('versionId', dynV1.id);
  licFd.append('validFrom', new Date(now - 60000).toISOString());
  licFd.append('validUntil', new Date(now + 4000).toISOString());
  licFd.append('departmentIds', engDept);
  const tempLic = await (await fetch(`${BASE}/admin/licenses`, {
    method: 'POST', headers: admin.setAuth(), body: licFd,
  })).json();
  ok('管理员登记许可文件+部门+短期截止日期', !!tempLic.id);

  // 4.3 有效期内 alice 拿到签名播放地址并成功播放
  const a1 = await json(await fetch(`${BASE}/courses/${dynV1.id}/access?mode=STREAM`, {
    method: 'POST', headers: alice.setAuth(),
  }));
  ok('有效期内拿到签名播放地址', !!a1.url && a1.expiresIn === 300);
  const play1 = await fetch(`${BASE}${a1.url}`, { headers: alice.setAuth() });
  ok('有效期内播放成功（200/206）', play1.status === 200 || play1.status === 206);

  // 4.4 下载地址与播放地址用途不可互换
  const a2 = await json(await fetch(`${BASE}/courses/${dynV1.id}/access?mode=DOWNLOAD`, {
    method: 'POST', headers: alice.setAuth(),
  }));
  const swappedUrl = a2.url.replace('/download/', '/stream/');
  const swapped = await fetch(`${BASE}${swappedUrl}`, { headers: alice.setAuth() });
  ok('下载签名不能用于播放（MODE_MISMATCH）', swapped.status === 403);

  // 4.5 等授权到期（签名 TTL 5 分钟，本身远未过期），再用旧地址播放/下载
  console.log('    等待授权到期（5 秒）…');
  await delay(5500);
  const replayStream = await fetch(`${BASE}${a1.url}`, { headers: alice.setAuth() });
  const replayBody = await json(replayStream);
  ok('到期后旧播放地址失效 → 403', replayStream.status === 403);
  const replayDl = await fetch(`${BASE}${a2.url}`, { headers: alice.setAuth() });
  ok('到期后旧下载地址失效 → 403', replayDl.status === 403);
  // 再次申请也被拒
  const reAccess = await fetch(`${BASE}/courses/${dynV1.id}/access?mode=STREAM`, {
    method: 'POST', headers: alice.setAuth(),
  });
  ok('到期后重新申请播放 → 403 EXPIRED', reAccess.status === 403);

  console.log('\n=== 5. 盗用他人签名地址 / 篡改签名 ===');
  // 新的临时许可（长期）给 alice，bob 拿到链接后换给别人、或 alice 的链接 bob 使用
  const licFd2 = new FormData();
  licFd2.append('licenseFile', new Blob([Buffer.from('许可2')]), 'temp-license2.pdf');
  licFd2.append('versionId', dynV1.id);
  licFd2.append('validFrom', new Date(Date.now() - 60000).toISOString());
  licFd2.append('validUntil', new Date(Date.now() + 86400000).toISOString());
  licFd2.append('departmentIds', engDept);
  // dynV1 已有当前许可（已到期但 ACTIVE）—— 到期许可挡不住“冲突校验”（只挡 ACTIVE 未到期），
  // 实际 conflict 条件为 status==='ACTIVE' 即挡，需先确认：到期许可仍 ACTIVE，会冲突。
  // 因此改用新走查课程的新版本。
  const fdV1b = await upload('video', 'dyn-v1b.mp4');
  fdV1b.append('courseId', dynCourse.id);
  fdV1b.append('versionLabel', 'v1b');
  const dynV1b = await (await fetch(`${BASE}/admin/versions`, { method: 'POST', headers: admin.setAuth(), body: fdV1b })).json();
  licFd2.set('versionId', dynV1b.id);
  const longLic = await json(await fetch(`${BASE}/admin/licenses`, {
    method: 'POST', headers: admin.setAuth(), body: licFd2,
  }));
  ok('为新版本登记长期许可', !!longLic.id, longLic);

  const aliceUrl = (await json(await fetch(`${BASE}/courses/${dynV1b.id}/access?mode=STREAM`, {
    method: 'POST', headers: alice.setAuth(),
  }))).url;
  // bob（销售部）拿 alice 的签名地址 + bob 自己的登录令牌访问
  const stolen = await fetch(`${BASE}${aliceUrl}`, { headers: bob.setAuth() });
  ok('他人签名地址跨用户使用 → 403 USER_MISMATCH', stolen.status === 403);
  // 篡改签名参数
  const tampered = aliceUrl.replace(/e=\d+/, 'e=9999999999');
  const tamperRes = await fetch(`${BASE}${tampered}`, { headers: alice.setAuth() });
  ok('篡改地址参数 → 403 BAD_SIGNATURE', tamperRes.status === 403);
  // bob 走正规申请，仍因部门不符被拒
  const bobApply = await fetch(`${BASE}/courses/${dynV1b.id}/access?mode=STREAM`, {
    method: 'POST', headers: bob.setAuth(),
  });
  ok('跨部门员工正规申请 → 403', bobApply.status === 403);
  // 无令牌访问
  const noAuth = await fetch(`${BASE}${aliceUrl}`);
  ok('未登录访问媒体 → 401', noAuth.status === 401);

  console.log('\n=== 6. 版本续签：必须选新版本，旧记录不改期，旧链接立即失效 ===');
  // 续签前列表：v2 许可即将到期
  const dueBefore = await json(await fetch(`${BASE}/admin/renew-due`, { headers: admin.setAuth() }));
  ok('续签前列表包含“安全生产培训 v2”', dueBefore.some((l: any) => l.versionId === v2.id), dueBefore.map((l:any)=>l.courseTitle+'-'+l.versionLabel));

  // 上传 v3 版本
  const fdV3 = await upload('video', 'safety-v3.mp4');
  fdV3.append('courseId', safety.id);
  fdV3.append('versionLabel', 'v3');
  const v3 = await json(await fetch(`${BASE}/admin/versions`, {
    method: 'POST', headers: admin.setAuth(), body: fdV3,
  }));
  ok('为续签上传对应课程的新版本 v3', !!v3.id, v3);

  // 续签前 alice 先拿到 v2 的播放地址
  const v2access = await json(await fetch(`${BASE}/courses/${v2.id}/access?mode=STREAM`, {
    method: 'POST', headers: alice.setAuth(),
  }));
  ok('续签前 v2 可正常获取播放地址', !!v2access.url, v2access);

  // 取 v2 当前许可 id
  const allLicBefore = await json(await fetch(`${BASE}/admin/licenses`, { headers: admin.setAuth() }));
  const v2Lic = allLicBefore.find((l: any) => l.versionId === v2.id && l.effectiveStatus === 'EXPIRING_SOON');

  // 用 v3 + 新许可文件续签
  const renewFd = new FormData();
  renewFd.append('licenseFile', new Blob([Buffer.from('v3 新授权')]), 'safety-v3-license.pdf');
  renewFd.append('versionId', v3.id);
  renewFd.append('oldLicenseId', v2Lic.id);
  renewFd.append('validFrom', new Date().toISOString());
  renewFd.append('validUntil', new Date(Date.now() + 365 * 86400000).toISOString());
  renewFd.append('departmentIds', engDept);
  const newLic = await json(await fetch(`${BASE}/admin/licenses`, {
    method: 'POST', headers: admin.setAuth(), body: renewFd,
  }));
  ok('续签生成一条全新许可记录', !!newLic.id && newLic.id !== v2Lic.id);

  // 校验旧许可：日期没变、只多了接替指针
  const allLicAfter = await json(await fetch(`${BASE}/admin/licenses`, { headers: admin.setAuth() }));
  const oldV2Lic = allLicAfter.find((l: any) => l.id === v2Lic.id);
  ok('旧许可未被改期，且标记为 RENEWED 指向新许可',
    oldV2Lic.supersededById === newLic.id &&
    oldV2Lic.effectiveStatus === 'RENEWED' &&
    new Date(oldV2Lic.validUntil).getTime() === new Date(v2Lic.validUntil).getTime());

  // 旧链接续签后立即失效
  const oldLinkAfterRenew = await fetch(`${BASE}${v2access.url}`, { headers: alice.setAuth() });
  ok('续签后旧版本链接立即失效 → 403 RENEWED', oldLinkAfterRenew.status === 403);
  // 旧版本不能再申请，新版本可以
  const v2Reapply = await fetch(`${BASE}/courses/${v2.id}/access?mode=STREAM`, {
    method: 'POST', headers: alice.setAuth(),
  });
  ok('续签后旧版本不再可申请', v2Reapply.status === 403);
  const v3access = await json(await fetch(`${BASE}/courses/${v3.id}/access?mode=STREAM`, {
    method: 'POST', headers: alice.setAuth(),
  }));
  const v3play = await fetch(`${BASE}${v3access.url}`, { headers: alice.setAuth() });
  ok('新版本 v3 可获取地址并播放', !!v3access.licenseId && v3access.licenseId === newLic.id && (v3play.status === 200 || v3play.status === 206));
  // 续签必须选对应课程版本：拿销售课程版本对 v2 续签应被拒
  const badRenewFd = new FormData();
  badRenewFd.append('licenseFile', new Blob([Buffer.from('x')]), 'x.pdf');
  badRenewFd.append('versionId', salesV1.id);
  badRenewFd.append('oldLicenseId', v2Lic.id);
  badRenewFd.append('validFrom', new Date().toISOString());
  badRenewFd.append('validUntil', new Date(Date.now() + 30 * 86400000).toISOString());
  badRenewFd.append('departmentIds', engDept);
  const badRenew = await fetch(`${BASE}/admin/licenses`, {
    method: 'POST', headers: admin.setAuth(), body: badRenewFd,
  });
  ok('用其他课程版本续签 → 400', badRenew.status === 400);
  // 同一许可不能重复续签
  const dupRenew = await fetch(`${BASE}/admin/licenses`, {
    method: 'POST', headers: admin.setAuth(), body: renewFd,
  });
  ok('重复续签同一旧许可 → 400', dupRenew.status === 400);

  console.log('\n=== 7. 下架：原因保留、链接失效 ===');
  // carol（人事部）对已下架的 onboard：申请被拒
  const onboardApply = await fetch(`${BASE}/courses/${onboardV1.id}/access?mode=STREAM`, {
    method: 'POST', headers: carol.setAuth(),
  });
  ok('已下架课程员工申请 → 403 TAKEN_DOWN', onboardApply.status === 403);
  // 对刚续签的 v3 许可下架（模拟许可方临时收回）
  const td = await fetch(`${BASE}/admin/licenses/${newLic.id}/takedown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({ reason: 'E2E 测试：许可方临时收回授权' }),
  });
  ok('管理员下架成功', td.status === 200);
  const noReason = await fetch(`${BASE}/admin/licenses/${newLic.id}/takedown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({ reason: '' }),
  });
  ok('下架原因必填', noReason.status === 400);
  // 下架后之前的 v3 播放地址立即失效
  const afterTd = await fetch(`${BASE}${v3access.url}`, { headers: alice.setAuth() });
  ok('下架后旧播放地址立即失效 → 403', afterTd.status === 403);
  const tdList = await json(await fetch(`${BASE}/admin/licenses?status=TAKEN_DOWN`, { headers: admin.setAuth() }));
  const tdItem = tdList.find((l: any) => l.id === newLic.id);
  ok('按 TAKEN_DOWN 筛选且下架原因保留', !!tdItem && tdItem.takeDownReason.includes('临时收回'));

  console.log('\n=== 8. 续签提醒（模拟实现） ===');
  const dueAfter = await json(await fetch(`${BASE}/admin/renew-due`, { headers: admin.setAuth() }));
  ok('续签后 v2 离开“未来一周续签”列表', !dueAfter.some((l: any) => l.versionId === v2.id));
  const scan = await json(await fetch(`${BASE}/admin/notifications/scan`, {
    method: 'POST', headers: admin.setAuth(),
  }));
  ok('模拟提醒扫描返回待提醒数量与消息', Array.isArray(scan.notifications) && typeof scan.dueCount === 'number');
  const notifs = await json(await fetch(`${BASE}/admin/notifications`, { headers: admin.setAuth() }));
  ok('提醒记录可查询', Array.isArray(notifs));

  console.log('\n=== 9. 历史授权链与访问记录回查 ===');
  const history = await json(await fetch(`${BASE}/admin/history?courseId=${safety.id}`, { headers: admin.setAuth() }));
  const labels = history.map((l: any) => l.versionLabel);
  ok('历史保留 v1(EXPIRED)/v2(RENEWED)/v3(TAKEN_DOWN) 全部记录',
    labels.includes('v1') && labels.includes('v2') && labels.includes('v3'));
  const logs = await json(await fetch(`${BASE}/admin/access-logs`, { headers: admin.setAuth() }));
  const reasons = new Set(logs.filter((x: any) => x.result === 'DENIED').map((x: any) => x.reason));
  ok('访问记录含拒绝原因（EXPIRED/DEPARTMENT_MISMATCH/RENEWED/TAKEN_DOWN 等）',
    ['EXPIRED', 'DEPARTMENT_MISMATCH', 'RENEWED', 'TAKEN_DOWN'].every((r) => reasons.has(r)),
    [...reasons]);
  ok('访问记录含 ALLOWED 播放记录', logs.some((x: any) => x.result === 'ALLOWED' && x.mode === 'STREAM'));
  const deniedOnly = await json(await fetch(`${BASE}/admin/access-logs?result=DENIED`, { headers: admin.setAuth() }));
  ok('访问记录支持按结果筛选', deniedOnly.every((x: any) => x.result === 'DENIED'));
  // 许可文件可回查下载
  const fileRes = await fetch(`${BASE}/admin/licenses/${newLic.id}/file`, { headers: admin.setAuth() });
  ok('登记的许可文件可由管理员下载回查', fileRes.status === 200);
  // 员工不能访问管理接口
  const adminAsEmployee = await fetch(`${BASE}/admin/licenses`, { headers: alice.setAuth() });
  ok('员工访问管理接口 → 403', adminAsEmployee.status === 403);

  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E 执行异常：', e);
  process.exit(2);
});
