import type { IconName } from './components/Icon';

export type PageKey = 'chat' | 'cases' | 'knowledge' | 'models' | 'customers' | 'pending' | 'model-admin' | 'settings';

export interface NavItem {
  key: PageKey;
  label: string;
  icon: IconName;
  subtitle: string;
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'chat', label: '对话检索', icon: 'chat', subtitle: '描述现象，调出历史维修记录' },
  { key: 'cases', label: '案例库', icon: 'cases', subtitle: '浏览、筛选与管理全部案例' },
  { key: 'knowledge', label: '技术知识库', icon: 'cases', subtitle: '查阅 BMC、时序与架构技术文档' },
  { key: 'models', label: '机型管理', icon: 'cpu', subtitle: '维护品牌与机型基础数据' },
  { key: 'customers', label: '客户管理', icon: 'users', subtitle: '维护客户与联系人信息' },
  { key: 'pending', label: '待审核', icon: 'review', subtitle: '审核新提交案例并归档' },
  { key: 'model-admin', label: '模型管理', icon: 'cpu', subtitle: '配置大模型、测试连接与调用日志' },
  { key: 'settings', label: '设置', icon: 'settings', subtitle: '系统信息与演示说明' },
];
