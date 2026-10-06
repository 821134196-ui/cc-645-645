/**
 * 端到端验证：授权到期、版本续签、越权访问旧链接 的完整过程。
 * 使用独立的 test.db，不影响开发库；脚本自带启动/关闭 Nest 服务。
 *
 * 运行：npm run test:e2e -w backend
 */
process.env.DATABASE_URL = 'file:./test.db';
process.env.SIGNING_SECRET = 'e2e-test-secret';
process.env.PORT = '3101';

import { execSync } from 'child_process';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';

const BASE = `http://localhost:${process.env.PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, extra ?? '');
  }
}

async function req(
  method: string,
  path: string,
  opts: { userId?: string; body?: unknown; raw?: boolean } = {},
) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(opts.userId ? { 'X-User-Id': opts.userId } : {}),
      ...(opts.body && !(opts.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
    },
    body: opts.body
      ? opts.body instanceof FormData
        ? opts.body
        : JSON.stringify(opts.body)
      : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* 非 JSON（视频流） */
  }
  return { status: res.status, json, res };
}

/** 请求并排空响应体，返回状态码（防止未消费的 body 占满连接池） */
async function statusCode(url: string | URL, init?: RequestInit): Promise<number> {
  const res = await fetch(url, init);
  await res.arrayBuffer();
  return res.status;
}

function licenseForm(versionId: string, deptIds: string[], from: Date, until: Date) {
  const fd = new FormData();
  fd.append('versionId', versionId);
  fd.append('licenseFile', new Blob(['E2E 许可文件'], { type: 'text/plain' }), 'e2e-license.txt');
  fd.append('departmentIds', JSON.stringify(deptIds));
  fd.append('validFrom', from.toISOString());
  fd.append('validUntil', until.toISOString());
  fd.append('note', 'e2e 自动生成');
  return fd;
}

async function main() {
  // ---- 准备独立测试库 ----
  console.log('==> 准备测试数据库 test.db');
  process.chdir(__dirname + '/..');
  execSync('rm -f prisma/test.db prisma/test.db-journal', { stdio: 'inherit' });
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
  });
  execSync('npx ts-node prisma/seed.ts', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
  });

  const app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(Number(process.env.PORT));
  console.log(`\n==> 测试服务已启动 ${BASE}\n`);

  try {
    // ---- 基础数据 ----
    const users = (await req('GET', '/api/users')).json;
    const zhangwei = users.find((u: any) => u.employeeNo === 'E001'); // 研发部
    const lina = users.find((u: any) => u.employeeNo === 'E002'); // 市场部
    const wangqiang = users.find((u: any) => u.employeeNo === 'E003'); // 人力资源部
    const depts = (await req('GET', '/api/admin/departments')).json;
    const dev = depts.find((d: any) => d.code === 'DEV');
    const mkt = depts.find((d: any) => d.code === 'MKT');
    const hr = depts.find((d: any) => d.code === 'HR');

    const courses = (await req('GET', '/api/admin/courses')).json;
    const findVersion = (courseTitle: string, label: string) => {
      const c = courses.find((x: any) => x.title === courseTitle);
      return c.versions.find((v: any) => v.versionLabel === label);
    };
    const onboardingV2 = findVersion('新员工入职培训', '2026-v2');
    const onboardingV1 = findVersion('新员工入职培训', '2025-v1');
    const securityV1 = findVersion('信息安全意识', '2026-v1');
    const perfV1 = findVersion('绩效考核制度解读', '2026-v1');
    const commV1 = findVersion('商务沟通技巧', '2025-v1');

    console.log('\n[场景 1] 员工课程列表显示到期时间');
    const myCourses = (await req('GET', '/api/me/courses', { userId: zhangwei.id })).json;
    const obCourse = myCourses.courses.find((c: any) => c.title === '新员工入职培训');
    check(
      '研发部员工能看到授权给研发部的课程，且带状态/截止日期/剩余天数',
      obCourse && obCourse.versions.length === 2 &&
        obCourse.versions.some(
          (v: any) => v.status === 'AVAILABLE' && v.daysLeft === 5 && v.validUntil,
        ),
      obCourse,
    );
    check(
      '仅授权人力资源部的绩效课程对研发部员工不可见',
      !myCourses.courses.some((c: any) => c.title === '绩效考核制度解读'),
    );
    const linaCourses = (await req('GET', '/api/me/courses', { userId: lina.id })).json;
    const secRow = linaCourses.courses
      .find((c: any) => c.title === '信息安全意识')
      .versions.find((v: any) => v.versionId === securityV1.id);
    check('昨天到期的课程在列表中显示为 EXPIRED', secRow.status === 'EXPIRED', secRow);
    const commRow = linaCourses.courses
      .find((c: any) => c.title === '商务沟通技巧')
      .versions.find((v: any) => v.versionId === commV1.id);
    check('已下架课程在列表中显示为 REVOKED', commRow.status === 'REVOKED', commRow);

    console.log('\n[场景 2] 正常播放：服务端签发短期地址 + Range 流式播放');
    const issue = await req('POST', '/api/media/issue', {
      userId: zhangwei.id,
      body: { versionId: onboardingV2.id, action: 'play' },
    });
    check('合法员工换取播放地址成功', issue.status === 200 && !!issue.json.url, issue.json);
    const signedUrl = new URL(issue.json.url);
    const streamRes = await fetch(signedUrl, { headers: { Range: 'bytes=0-1023' } });
    check('签名地址可播放且支持 Range（206）', streamRes.status === 206, streamRes.status);
    await streamRes.arrayBuffer();
    const cr = streamRes.headers.get('content-range') || '';
    check('返回 Content-Range: bytes 0-1023/*', cr.startsWith('bytes 0-1023/'), cr);

    console.log('\n[场景 3] 越权访问：跨部门员工被拒绝');
    const cross = await req('POST', '/api/media/issue', {
      userId: lina.id, // 市场部
      body: { versionId: onboardingV1.id, action: 'play' }, // v1 仅授权研发部
    });
    check('市场部员工无法打开仅授权研发部的版本（403）', cross.status === 403, cross.json);
    const crossDl = await req('POST', '/api/media/issue', {
      userId: zhangwei.id,
      body: { versionId: perfV1.id, action: 'download' }, // 绩效仅人力资源部
    });
    check('研发部员工无法下载仅授权人力资源部的视频（403）', crossDl.status === 403, crossDl.json);

    console.log('\n[场景 4] 篡改/伪造旧链接被拒');
    const tampered = `${signedUrl.pathname}${signedUrl.search.replace(
      /u=[^&]+/,
      `u=${lina.id}`,
    )}`;
    const tamperRes = await fetch(`${BASE}${tampered}`);
    await tamperRes.arrayBuffer();
    check('把链接中的用户换成别的部门员工 → 签名校验失败 403', tamperRes.status === 403);
    const badSig = `${signedUrl.pathname}${signedUrl.search.replace(/sig=[^&]+/, 'sig=fake')}`;
    check('伪造签名 → 403', await statusCode(`${BASE}${badSig}`) === 403);

    console.log('\n[场景 5] 授权到期：先拿到合法地址，到期后同一地址失效');
    const now = Date.now();
    const renewShort = await req('POST', '/api/admin/licenses/renew', {
      body: licenseForm(
        securityV1.id,
        [dev.id, mkt.id, hr.id],
        new Date(now - 60_000),
        new Date(now + 3_000),
      ),
    });
    check('为已到期版本续签 3 秒短许可成功（产生新记录）', renewShort.status === 201, renewShort.json);
    const shortIssue = await req('POST', '/api/media/issue', {
      userId: wangqiang.id,
      body: { versionId: securityV1.id, action: 'play' },
    });
    check('短许可有效期内可换取地址', shortIssue.status === 200, shortIssue.json);
    const shortUrl = shortIssue.json.url;
    check('短许可有效期内访问被放行（200 全量流式）', await statusCode(shortUrl) === 200);
    console.log('    等待许可到期（3.5 秒）…');
    await sleep(3_500);
    const afterExpireCode = await statusCode(shortUrl);
    check('许可到期后，员工手中之前的播放地址立即失效（403）', afterExpireCode === 403);
    const reIssue = await req('POST', '/api/media/issue', {
      userId: wangqiang.id,
      body: { versionId: securityV1.id, action: 'play' },
    });
    check('到期后重新打开视频同样被拒（403 LICENSE_EXPIRED）', reIssue.status === 403, reIssue.json);

    console.log('\n[场景 6] 版本续签：必须新建记录，旧许可不被延长');
    const historyBefore = (await req('GET', `/api/admin/versions/${onboardingV2.id}/license-history`)).json;
    const oldActive = historyBefore.find((l: any) => l.status === 'ACTIVE');
    const oldUntil = oldActive.validUntil;
    const renewLong = await req('POST', '/api/admin/licenses/renew', {
      body: licenseForm(
        onboardingV2.id,
        [dev.id, mkt.id],
        new Date(now - 1_000),
        new Date(now + 365 * 86400000),
      ),
    });
    check('续签成功返回 201 并生成新许可行', renewLong.status === 201, renewLong.json);
    check('新许可与旧许可 ID 不同', renewLong.json.id !== oldActive.id);
    const historyAfter = (await req('GET', `/api/admin/versions/${onboardingV2.id}/license-history`)).json;
    const oldRow = historyAfter.find((l: any) => l.id === oldActive.id);
    check('旧许可记录仍保留且截止日期未被改动', oldRow.validUntil === oldUntil, {
      before: oldUntil,
      after: oldRow.validUntil,
    });
    check('旧许可状态变为 SUPERSEDED（已被续签替代）', oldRow.status === 'SUPERSEDED', oldRow.status);
    check(
      '新许可为 ACTIVE 且对应同一个视频版本',
      historyAfter[0].status === 'ACTIVE' && historyAfter[0].versionId === onboardingV2.id,
    );
    const stillPlayCode = await statusCode(signedUrl);
    check('续签后员工早先拿到的版本地址仍可播放（服务端按新许可重新授权，200）', stillPlayCode === 200, stillPlayCode);

    console.log('\n[场景 7] 下架：原因留存 + 旧链接立即失效');
    const newLicenseId = renewLong.json.id;
    const revoke = await req('POST', `/api/admin/licenses/${newLicenseId}/revoke`, {
      body: { reason: '' },
    });
    check('下架不填原因被拒绝（400）', revoke.status === 400, revoke.json);
    const revokeOk = await req('POST', `/api/admin/licenses/${newLicenseId}/revoke`, {
      body: { reason: '版权方终止授权，e2e 测试下架' },
    });
    check('填写原因后下架成功', revokeOk.status === 201, revokeOk.json);
    const afterRevokeCode = await statusCode(signedUrl);
    check('下架后此前已签发的播放/下载地址立即失效（403）', afterRevokeCode === 403);
    const issueAfterRevoke = await req('POST', '/api/media/issue', {
      userId: zhangwei.id,
      body: { versionId: onboardingV2.id, action: 'play' },
    });
    check('下架后无法再换取新地址（403）', issueAfterRevoke.status === 403);
    const historyFinal = (await req('GET', `/api/admin/versions/${onboardingV2.id}/license-history`)).json;
    const revokedRow = historyFinal.find((l: any) => l.id === newLicenseId);
    check('下架许可状态 REVOKED 且原因完整保留',
      revokedRow.status === 'REVOKED' && revokedRow.revokeReason === '版权方终止授权，e2e 测试下架',
      revokedRow,
    );
    check('授权历史完整保留（登记/续签/下架各代记录都在）', historyFinal.length >= 2);

    console.log('\n[场景 8] 管理端续签清单与状态筛选');
    const due = (await req('GET', '/api/admin/renewals-due?days=7')).json;
    check(
      '续签清单包含已过期的信息安全课程',
      due.some((l: any) => l.versionId === securityV1.id && l.overdue === true),
      due.map((l: any) => ({ v: l.versionId, overdue: l.overdue })),
    );
    check(
      '已续签为一年期且随后下架的入职培训 v2 不再出现在续签清单',
      !due.some((l: any) => l.versionId === onboardingV2.id),
    );
    const activeOnly = (await req('GET', '/api/admin/licenses?status=ACTIVE')).json;
    const revokedOnly = (await req('GET', '/api/admin/licenses?status=REVOKED')).json;
    check('按状态筛选 ACTIVE 不混入其他状态', activeOnly.every((l: any) => l.status === 'ACTIVE'));
    check(
      '按状态筛选 REVOKED 能查到含下架原因的记录',
      revokedOnly.some((l: any) => l.id === newLicenseId && l.revokeReason),
    );

    console.log('\n[场景 9] 访问记录完整留存（放行与拒绝均可回查）');
    const logsDenied = (await req('GET', '/api/admin/access-logs?result=DENIED')).json;
    check('跨部门拒绝已记录 (DEPARTMENT_NOT_LICENSED)',
      logsDenied.some((l: any) => l.reason === 'DEPARTMENT_NOT_LICENSED' && l.userId === lina.id));
    check('到期拒绝已记录 (LICENSE_EXPIRED)',
      logsDenied.some((l: any) => l.reason === 'LICENSE_EXPIRED'));
    check('篡改/失效链接拒绝已记录 (INVALID_OR_EXPIRED_URL)',
      logsDenied.some((l: any) => l.reason === 'INVALID_OR_EXPIRED_URL'));
    check('下架后旧链接拒绝已记录 (NO_ACTIVE_LICENSE:REVOKED)',
      logsDenied.some((l: any) => l.reason === 'NO_ACTIVE_LICENSE:REVOKED'));
    const logsGranted = (await req('GET', '/api/admin/access-logs?result=GRANTED')).json;
    check('放行的播放请求也已记录 (STREAM)',
      logsGranted.some((l: any) => l.action === 'STREAM' && l.versionId === onboardingV2.id));

    console.log('\n[场景 10] 模拟提醒');
    const scan = await req('POST', '/api/admin/reminders/scan?days=7');
    check('提醒扫描命中临期/已过期许可', scan.status === 201 && scan.json.scanned >= 1, scan.json);
    const reminders = (await req('GET', '/api/admin/reminders')).json;
    check('模拟提醒落库可查（MOCK_EMAIL）',
      reminders.length >= 1 && reminders[0].channel === 'MOCK_EMAIL' && reminders[0].content);
    const scan2 = await req('POST', '/api/admin/reminders/scan?days=7');
    check('同一天重复扫描不会产生重复提醒', scan2.json.sent === 0, scan2.json);
  } finally {
    await app.close();
  }

  console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
