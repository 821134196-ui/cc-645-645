import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const day = 24 * 60 * 60 * 1000;
const at = (offsetDays: number, hour = 18) => {
  const d = new Date(Date.now() + offsetDays * day);
  d.setHours(hour, 0, 0, 0);
  return d;
};

/** 生成占位“视频”文件（授权流程演示用，并非真实编码的 mp4） */
function writeFakeVideo(name: string, sizeBytes = 1024 * 128) {
  const dir = path.join(__dirname, '..', 'media');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) {
    // 写入 ftyp 头，尽量让浏览器识别为 mp4 容器，其余填充 0
    const buf = Buffer.alloc(sizeBytes);
    buf.write('ftypmp42', 4, 'ascii');
    fs.writeFileSync(file, buf);
  }
  return file;
}

function writeFakeLicense(name: string, body: string) {
  const dir = path.join(__dirname, '..', 'uploads', 'licenses');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
}

async function main() {
  // 默认幂等：数据库已有数据则跳过；RESEED=1 时强制重建演示数据
  const userCount = await prisma.user.count();
  if (userCount > 0 && process.env.RESEED !== '1') {
    console.log('数据库已有数据，跳过种子（如需重置演示数据：RESEED=1 npm run prisma:seed）');
    return;
  }

  // 清理（顺序按外键依赖）
  await prisma.accessLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.licenseDepartment.deleteMany();
  await prisma.license.deleteMany();
  await prisma.videoVersion.deleteMany();
  await prisma.course.deleteMany();
  await prisma.user.deleteMany();
  await prisma.department.deleteMany();

  const eng = await prisma.department.create({ data: { name: '研发部' } });
  const sales = await prisma.department.create({ data: { name: '销售部' } });
  const hr = await prisma.department.create({ data: { name: '人事部' } });

  await prisma.user.createMany({
    data: [
      { name: '系统管理员', account: 'admin', role: 'ADMIN', departmentId: eng.id },
      { name: '张爱研', account: 'alice', role: 'EMPLOYEE', departmentId: eng.id },
      { name: '李销冠', account: 'bob', role: 'EMPLOYEE', departmentId: sales.id },
      { name: '王人事', account: 'carol', role: 'EMPLOYEE', departmentId: hr.id },
    ],
  });

  // 课程 1：安全生产培训，有 v1（许可已到期）和 v2（3 天后到期，需要续签）
  const safety = await prisma.course.create({
    data: { title: '安全生产培训', description: '新员工必修，年度复训' },
  });
  const safetyV1 = await prisma.videoVersion.create({
    data: {
      courseId: safety.id,
      versionLabel: 'v1',
      filePath: path.relative(path.join(__dirname, '..'), writeFakeVideo('safety-v1.mp4')),
      fileSize: 1024 * 128,
    },
  });
  const safetyV2 = await prisma.videoVersion.create({
    data: {
      courseId: safety.id,
      versionLabel: 'v2',
      filePath: path.relative(path.join(__dirname, '..'), writeFakeVideo('safety-v2.mp4')),
      fileSize: 1024 * 256,
    },
  });

  // v1 旧许可：2 天前已到期（员工手里的旧链接应当失效）
  await prisma.license.create({
    data: {
      versionId: safetyV1.id,
      licenseFile: path.relative(path.join(__dirname, '..'), writeFakeLicense('safety-v1-license.txt', '安全生产培训 v1 授权文件（已到期）')),
      licenseFileName: 'safety-v1-license.pdf',
      validFrom: at(-365),
      validUntil: at(-2),
      status: 'ACTIVE',
      departments: { create: [{ departmentId: eng.id }] },
    },
  });

  // v2 新许可：3 天后到期（未来一周需要续签）
  await prisma.license.create({
    data: {
      versionId: safetyV2.id,
      licenseFile: path.relative(path.join(__dirname, '..'), writeFakeLicense('safety-v2-license.txt', '安全生产培训 v2 授权文件')),
      licenseFileName: 'safety-v2-license.pdf',
      validFrom: at(-30),
      validUntil: at(3),
      status: 'ACTIVE',
      departments: { create: [{ departmentId: eng.id }] },
    },
  });

  // 课程 2：销售技巧——仅销售部授权（跨部门访问测试）
  const salesCourse = await prisma.course.create({ data: { title: '销售技巧精讲' } });
  const salesV1 = await prisma.videoVersion.create({
    data: {
      courseId: salesCourse.id,
      versionLabel: 'v1',
      filePath: path.relative(path.join(__dirname, '..'), writeFakeVideo('sales-v1.mp4')),
      fileSize: 1024 * 128,
    },
  });
  await prisma.license.create({
    data: {
      versionId: salesV1.id,
      licenseFile: path.relative(path.join(__dirname, '..'), writeFakeLicense('sales-v1-license.txt', '销售技巧 v1 授权文件')),
      licenseFileName: 'sales-v1-license.pdf',
      validFrom: at(-10),
      validUntil: at(30),
      status: 'ACTIVE',
      departments: { create: [{ departmentId: sales.id }] },
    },
  });

  // 课程 3：入职合规——已被管理员下架（下架原因保留）
  const onboard = await prisma.course.create({ data: { title: '入职合规指引' } });
  const onboardV1 = await prisma.videoVersion.create({
    data: {
      courseId: onboard.id,
      versionLabel: 'v1',
      filePath: path.relative(path.join(__dirname, '..'), writeFakeVideo('onboard-v1.mp4')),
      fileSize: 1024 * 128,
    },
  });
  await prisma.license.create({
    data: {
      versionId: onboardV1.id,
      licenseFile: path.relative(path.join(__dirname, '..'), writeFakeLicense('onboard-v1-license.txt', '入职合规 v1 授权文件')),
      licenseFileName: 'onboard-v1-license.pdf',
      validFrom: at(-60),
      validUntil: at(60),
      status: 'TAKEN_DOWN',
      takeDownReason: '许可方要求：内容更新，旧版本停止使用',
      takenDownAt: at(-1),
      departments: { create: [{ departmentId: hr.id }] },
    },
  });

  // 课程 4：信息安全基础——长期有效
  const sec = await prisma.course.create({ data: { title: '信息安全基础' } });
  const secV1 = await prisma.videoVersion.create({
    data: {
      courseId: sec.id,
      versionLabel: 'v1',
      filePath: path.relative(path.join(__dirname, '..'), writeFakeVideo('security-v1.mp4')),
      fileSize: 1024 * 128,
    },
  });
  await prisma.license.create({
    data: {
      versionId: secV1.id,
      licenseFile: path.relative(path.join(__dirname, '..'), writeFakeLicense('security-v1-license.txt', '信息安全基础 v1 授权文件')),
      licenseFileName: 'security-v1-license.pdf',
      validFrom: at(-20),
      validUntil: at(180),
      status: 'ACTIVE',
      departments: { create: [{ departmentId: eng.id }] },
    },
  });

  console.log('种子数据完成：admin / alice(研发部) / bob(销售部) / carol(人事部)，初始密码均为 123456');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
