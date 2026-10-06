import { PrismaClient } from '@prisma/client';
import { existsSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

const VIDEO_DIR = join(__dirname, '..', 'storage', 'videos');
const LICENSE_DIR = join(__dirname, '..', 'storage', 'licenses');
mkdirSync(VIDEO_DIR, { recursive: true });
mkdirSync(LICENSE_DIR, { recursive: true });

const DAY = 86400000;

/** 准备本地视频文件：优先下载公开小样本，失败则写入占位文件（流式/Range 测试仍可验证） */
async function ensureVideo(filePath: string) {
  if (existsSync(filePath) && statSync(filePath).size > 10000) return;
  const urls = [
    'https://download.samplelib.com/mp4/sample-5s.mp4',
    'https://www.w3schools.com/html/mov_bbb.mp4',
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 10000) {
          writeFileSync(filePath, buf);
          console.log(`视频样本下载成功: ${filePath} (${buf.length} bytes)`);
          return;
        }
      }
    } catch {
      /* 尝试下一个地址 */
    }
  }
  // 无网络时的占位文件（非可播放 MP4，但足以验证鉴权与流式传输）
  writeFileSync(filePath, Buffer.alloc(200_000, 0x6d));
  console.log(`使用占位视频文件: ${filePath}（环境无外网，播放器可能无法解码）`);
}

function writeLicenseFile(name: string, content: string) {
  const path = join(LICENSE_DIR, name);
  writeFileSync(path, content, 'utf8');
  return path;
}

async function main() {
  // 幂等：清空重建
  await prisma.reminder.deleteMany();
  await prisma.accessLog.deleteMany();
  await prisma.licenseDepartment.deleteMany();
  await prisma.license.deleteMany();
  await prisma.videoVersion.deleteMany();
  await prisma.course.deleteMany();
  await prisma.user.deleteMany();
  await prisma.department.deleteMany();

  const dev = await prisma.department.create({ data: { name: '研发部', code: 'DEV' } });
  const mkt = await prisma.department.create({ data: { name: '市场部', code: 'MKT' } });
  const hr = await prisma.department.create({ data: { name: '人力资源部', code: 'HR' } });

  await prisma.user.createMany({
    data: [
      { name: '张伟', employeeNo: 'E001', role: 'EMPLOYEE', departmentId: dev.id },
      { name: '李娜', employeeNo: 'E002', role: 'EMPLOYEE', departmentId: mkt.id },
      { name: '王强', employeeNo: 'E003', role: 'EMPLOYEE', departmentId: hr.id },
      { name: '管理员', employeeNo: 'A001', role: 'ADMIN', departmentId: hr.id },
    ],
  });
  const zhangwei = await prisma.user.findUniqueOrThrow({ where: { employeeNo: 'E001' } });
  void zhangwei;

  const now = Date.now();

  // 课程 1：入职培训，两个版本（v1 仅研发；v2 研发+市场，5 天后到期 → 续签清单）
  const course1 = await prisma.course.create({
    data: { title: '新员工入职培训', description: '公司制度、办公系统与安全规范入门' },
  });
  const v1File = join(VIDEO_DIR, 'onboarding-v1.mp4');
  const v2File = join(VIDEO_DIR, 'onboarding-v2.mp4');
  await ensureVideo(v1File);
  await ensureVideo(v2File);
  const v1 = await prisma.videoVersion.create({
    data: {
      courseId: course1.id,
      versionLabel: '2025-v1',
      lecturer: '刘敏讲师',
      fileName: '入职培训-2025版.mp4',
      filePath: v1File,
      durationSec: 312,
    },
  });
  const v2 = await prisma.videoVersion.create({
    data: {
      courseId: course1.id,
      versionLabel: '2026-v2',
      lecturer: '刘敏讲师',
      fileName: '入职培训-2026修订版.mp4',
      filePath: v2File,
      durationSec: 358,
    },
  });

  await prisma.license.create({
    data: {
      versionId: v1.id,
      licenseFileName: '入职培训v1-许可.pdf',
      licenseFilePath: writeLicenseFile(
        'onboarding-v1-license.txt',
        '许可文件（演示）：新员工入职培训 2025-v1，授权研发部，有效期 30 天。',
      ),
      validFrom: new Date(now - 20 * DAY),
      validUntil: new Date(now + 30 * DAY),
      departments: { create: [{ departmentId: dev.id }] },
    },
  });
  await prisma.license.create({
    data: {
      versionId: v2.id,
      licenseFileName: '入职培训v2-许可.pdf',
      licenseFilePath: writeLicenseFile(
        'onboarding-v2-license.txt',
        '许可文件（演示）：新员工入职培训 2026-v2，授权研发部、市场部，5 天后到期。',
      ),
      validFrom: new Date(now - 25 * DAY),
      validUntil: new Date(now + 5 * DAY),
      departments: { create: [{ departmentId: dev.id }, { departmentId: mkt.id }] },
    },
  });

  // 课程 2：信息安全，许可昨天已到期（员工旧链接应失效）
  const course2 = await prisma.course.create({
    data: { title: '信息安全意识', description: '数据分级、钓鱼邮件与办公安全' },
  });
  const secFile = join(VIDEO_DIR, 'security-v1.mp4');
  await ensureVideo(secFile);
  const secV1 = await prisma.videoVersion.create({
    data: {
      courseId: course2.id,
      versionLabel: '2026-v1',
      lecturer: '陈安全讲师',
      fileName: '信息安全意识.mp4',
      filePath: secFile,
      durationSec: 420,
    },
  });
  await prisma.license.create({
    data: {
      versionId: secV1.id,
      licenseFileName: '信息安全-许可.pdf',
      licenseFilePath: writeLicenseFile(
        'security-license.txt',
        '许可文件（演示）：信息安全意识，授权全部三个部门，已到期待续签/下架。',
      ),
      validFrom: new Date(now - 90 * DAY),
      validUntil: new Date(now - 1 * DAY),
      departments: {
        create: [{ departmentId: dev.id }, { departmentId: mkt.id }, { departmentId: hr.id }],
      },
    },
  });

  // 课程 3：商务沟通，经历 登记 → 续签(SUPERSEDED) → 下架(REVOKED)，历史完整保留
  const course3 = await prisma.course.create({
    data: { title: '商务沟通技巧', description: '跨部门协作与商务表达' },
  });
  const commFile = join(VIDEO_DIR, 'communication-v1.mp4');
  await ensureVideo(commFile);
  const commV1 = await prisma.videoVersion.create({
    data: {
      courseId: course3.id,
      versionLabel: '2025-v1',
      lecturer: '赵沟通讲师',
      fileName: '商务沟通技巧.mp4',
      filePath: commFile,
      durationSec: 600,
    },
  });
  await prisma.license.create({
    data: {
      versionId: commV1.id,
      licenseFileName: '商务沟通-初版许可.pdf',
      licenseFilePath: writeLicenseFile(
        'communication-license-1.txt',
        '初版许可（演示）：商务沟通技巧，授权市场部，后被续签替代。',
      ),
      validFrom: new Date(now - 180 * DAY),
      validUntil: new Date(now - 100 * DAY),
      status: 'SUPERSEDED',
      departments: { create: [{ departmentId: mkt.id }] },
    },
  });
  await prisma.license.create({
    data: {
      versionId: commV1.id,
      licenseFileName: '商务沟通-续签许可.pdf',
      licenseFilePath: writeLicenseFile(
        'communication-license-2.txt',
        '续签许可（演示）：商务沟通技巧，授权市场部，后因讲师协议终止下架。',
      ),
      validFrom: new Date(now - 100 * DAY),
      validUntil: new Date(now + 200 * DAY),
      status: 'REVOKED',
      revokeReason: '讲师授权合作协议终止，版权方要求全网下架',
      departments: { create: [{ departmentId: mkt.id }] },
    },
  });

  // 课程 4：绩效制度，仅授权人力资源部（跨部门访问测试）
  const course4 = await prisma.course.create({
    data: { title: '绩效考核制度解读', description: '年度考核流程与 OKR 规范' },
  });
  const perfFile = join(VIDEO_DIR, 'performance-v1.mp4');
  await ensureVideo(perfFile);
  const perfV1 = await prisma.videoVersion.create({
    data: {
      courseId: course4.id,
      versionLabel: '2026-v1',
      lecturer: '孙绩效讲师',
      fileName: '绩效考核制度解读.mp4',
      filePath: perfFile,
      durationSec: 255,
    },
  });
  await prisma.license.create({
    data: {
      versionId: perfV1.id,
      licenseFileName: '绩效制度-许可.pdf',
      licenseFilePath: writeLicenseFile(
        'performance-license.txt',
        '许可文件（演示）：绩效考核制度解读，仅授权人力资源部。',
      ),
      validFrom: new Date(now - 10 * DAY),
      validUntil: new Date(now + 60 * DAY),
      departments: { create: [{ departmentId: hr.id }] },
    },
  });

  console.log('种子数据完成：3 个部门 / 4 个员工 / 4 门课程 / 6 条许可');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
