export type ZoneName = 'A' | 'B' | 'C';
export type SlotStatus = 'empty' | 'reserved' | 'review' | 'available' | 'returned' | 'disabled';

export type DemoItem = {
  id: string;
  slot: string;
  name: string;
  points: number;
  category: string;
  icon: 'book' | 'lamp' | 'ball' | 'bag';
  status: SlotStatus;
  condition: string;
  note: string;
  photoUrl?: string;
  isReal?: boolean;
  donationId?: number;
};

export const ZONE_CONFIGS = {
  A: { label: '小件区', total: 100, perPage: 20, columns: 5, rows: 4 },
  B: { label: '中件区', total: 50, perPage: 12, columns: 4, rows: 3 },
  C: { label: '大件区', total: 20, perPage: 4, columns: 2, rows: 2 },
} satisfies Record<ZoneName, { label: string; total: number; perPage: number; columns: number; rows: number }>;

export const DEMO_ITEMS: DemoItem[] = [
  { id: 'demo-book', slot: 'A03', name: '《昆虫记》', points: 12, category: '图书', icon: 'book', status: 'available', condition: '书页整洁', note: '界面展示样例，不代表真实库存。' },
  { id: 'demo-lamp', slot: 'A14', name: '折叠阅读灯', points: 18, category: '文具', icon: 'lamp', status: 'review', condition: '外观良好', note: '仅演示待审核状态，不会实际加分或上架。' },
  { id: 'demo-ball', slot: 'B08', name: '训练篮球', points: 25, category: '运动', icon: 'ball', status: 'available', condition: '轻微使用痕迹', note: '界面展示样例，不可真实领取。' },
  { id: 'demo-bag', slot: 'C03', name: '双肩书包', points: 30, category: '生活', icon: 'bag', status: 'available', condition: '拉链正常', note: '界面展示样例，不可真实领取。' },
];

export const SLOT_OVERRIDES: Partial<Record<string, SlotStatus>> = {
  A14: 'review',
  B02: 'reserved',
  C04: 'disabled',
};

export const DEMO_REVIEWS = [
  { id: 'review-1', item: '折叠阅读灯', student: '林小满', className: '初二（3）班', slot: 'A14', suggestion: 18 },
  { id: 'review-2', item: '几何工具盒', student: '周星禾', className: '初一（2）班', slot: 'A21', suggestion: 10 },
];

export const DEMO_STUDENTS = [
  { name: '林小满', studentId: 'DEMO001', className: '初二（3）班' },
  { name: '周星禾', studentId: 'DEMO002', className: '初一（2）班' },
  { name: '陈木川', studentId: 'DEMO003', className: '初三（1）班' },
];
