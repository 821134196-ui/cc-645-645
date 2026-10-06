export interface UserInfo {
  id: string;
  account: string;
  name: string;
  role: 'ADMIN' | 'EMPLOYEE';
  department: { id: string; name: string };
}

export type EffectiveStatus =
  | 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'TAKEN_DOWN' | 'RENEWED' | 'NO_LICENSE';

export interface CourseVersionView {
  id: string;
  versionLabel: string;
  status: EffectiveStatus;
  statusText: string;
  deptGranted: boolean;
  playable: boolean;
  validFrom: string | null;
  validUntil: string | null;
  takeDownReason: string | null;
}

export interface CourseView {
  id: string;
  title: string;
  description: string | null;
  versions: CourseVersionView[];
}

export interface LicenseView {
  id: string;
  licenseFileName: string;
  licenseFile: string;
  validFrom: string;
  validUntil: string;
  storedStatus: string;
  takeDownReason: string | null;
  takenDownAt: string | null;
  createdAt: string;
  effectiveStatus: EffectiveStatus;
  versionId: string;
  versionLabel: string;
  courseId: string;
  courseTitle: string;
  departments: { id: string; name: string }[];
  supersededById: string | null;
  supersededByVersion?: string | null;
  daysLeft?: number;
}

export interface AccessLogView {
  id: string;
  mode: 'STREAM' | 'DOWNLOAD';
  result: 'ALLOWED' | 'DENIED';
  reason: string | null;
  createdAt: string;
  user?: { name: string; account: string; department?: { name: string } };
  version?: { versionLabel: string; course?: { title: string } };
}

export interface NotificationView {
  id: string;
  type: string;
  message: string;
  sent: boolean;
  createdAt: string;
}
