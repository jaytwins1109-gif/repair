import { db } from '../db';
import type { LlmPlatform } from '../db';

type SymptomSeed = { standard: string; aliases: string; category?: string };
type ModelAliasSeed = { canonical: string; aliases: string };

const SYMPTOM_SEEDS: SymptomSeed[] = [
  { standard: '无显示', aliases: '不显示,不通显,没有画面,无图像输出,无视频输出,黑屏,不开机没画面,no video' },
  { standard: '风扇满转', aliases: '风扇狂转,风扇拉满,风扇全速,风扇转速最高,风扇一直满速,fan full speed' },
  { standard: '不加电', aliases: '不上电,按电源键没反应,按开机键无反应,电源键无反应,通电无反应' },
  { standard: '无法开机', aliases: '开不了机,起不来,点不亮,无法启动系统' },
  { standard: '内存报错', aliases: 'ECC报错,内存告警,内存训练失败,内存不识别,内存报错计数上涨' },
  { standard: '异常掉电', aliases: '突然断电,运行中掉电,自动关机,负载高时断电' },
  { standard: '反复重启', aliases: '循环重启,自动重启,反复重新启动' },
  { standard: '启动卡住', aliases: '卡logo,卡在启动画面,进不去系统卡住' },
  { standard: '蓝屏', aliases: '死机蓝屏,BSOD,系统蓝屏死机' },
  { standard: '温度过高', aliases: '过温,高温告警,散热不良,温度报警' },
  { standard: '指示灯异常', aliases: '指示灯不亮,故障灯亮,电源灯橙色,面板灯异常' },
  { standard: '无法远程', aliases: 'BMC无法访问,iLO连不上,iDRAC打不开,带外管理连不上' },
  { standard: '风扇噪音异常', aliases: '风扇声音大,风扇异响,转速波动' },
  { standard: 'CMOS丢失', aliases: '系统时间归零,BIOS设置丢失,时间重置' },
];

const MODEL_ALIAS_SEEDS: ModelAliasSeed[] = [
  { canonical: '联想 SR650', aliases: 'SR650,Lenovo SR650,ThinkSystem SR650,SR650 Gen10,联想650' },
  { canonical: '联想 SR850', aliases: 'SR850,ThinkSystem SR850,联想850' },
  { canonical: '戴尔 R740', aliases: 'R740,PowerEdge R740,Dell R740,戴尔740' },
  { canonical: '戴尔 R750', aliases: 'R750,PowerEdge R750,Dell R750' },
  { canonical: '惠普 DL380 Gen10', aliases: 'DL380 Gen10,DL380 G10,HP DL380,HPE DL380,惠普380' },
  { canonical: '浪潮 NF5280M5', aliases: 'NF5280M5,NF5280 M5,Inspur NF5280M5,浪潮5280' },
  { canonical: '华为 2288H V5', aliases: '2288H V5,2288HV5,华为2288H,2288H' },
];

// 品牌|型号|客户|故障现象|诊断过程|解决方案|故障分类|更换配件|维修日期|备注
const CASE_SEEDS: string[] = [
  '联想|SR650|华为|开机无显示，风扇满转|电源模块12V输出异常，单路电源老化导致供电不足，主板自检未通过|更换故障电源模块，复测12V与5V输出正常，烤机4小时无异常|供电类|电源模块|2024-03-12|首批种子',
  '联想|SR650|华为|开机黑屏，前面板指示灯常亮|内存条金手指氧化接触不良，内存训练失败|橡皮清洁金手指后重新插拔并更换插槽，正常点亮|内存类||2024-04-08|',
  '联想|SR650|中兴|不加电，按电源键没反应，待机灯不亮|前面板电源按键排线脱落，BMC 检测不到开机信号|重新插紧前面板排线，连续开关机测试10次正常|接口类||2024-05-16|',
  '戴尔|R740|中兴|开机无图像输出，风扇拉满|电源转换电路故障，CPU供电MOS管击穿导致主板供电异常|更换主板后开机正常，旧板返修|CPU供电类|主板|2024-06-21|',
  '戴尔|R740|中国移动|反复重启，启动卡logo|CMOS电池无电导致BIOS设置丢失，启动模式错乱|更换CR2032电池并重新导入BIOS配置|其他|CMOS电池|2024-07-09|',
  '惠普|DL380 Gen10|华为|开机不显示，iLO报电压传感器读数异常|主板3.3V待机供电电路贴片电容鼓包，待机电压偏低|更换鼓包电容，复测待机电压恢复正常|供电类|贴片电容|2024-08-14|',
  '浪潮|NF5280M5|中国移动|内存报错频繁，ECC纠正错误计数持续上涨|交叉换位定位到第7通道一条内存故障，故障跟随内存条|更换该条内存后计数不再增长|内存类|内存条|2024-09-22|',
  '浪潮|NF5280M5|中国电信|风扇噪音异常，转速长期满转|进风口温度传感器虚报高温，BMC按异常温度拉满风扇|更换温度传感器并刷新BMC固件|散热类|温度传感器|2024-10-30|',
  '华为|2288H V5|中国联通|上电不通显，BMC无法访问|主板3.3V待机短路，BMC供电芯片烧毁|更换BMC供电芯片并补焊，远程管理恢复|CPU供电类|BMC供电芯片|2024-11-25|',
  '超云|R5220 G3|某数据中心|无法开机，电源模块指示灯橙色|机柜PDU单相供电异常导致电源进入保护，机器本身无故障|更换PDU插位后恢复正常|其他||2024-12-18|外部供电问题，非机器故障',
  '联想|SR850|华为|运行中异常掉电，日志记录PSU2丢失|电源模块2内部过流保护，满载时单电源无法承载|更换电源模块2并做负载分担调整|供电类|电源模块|2025-01-14|',
  '联想|SR850|华为|开机无显示，报CPU0错误|CPU插座针脚有弯针，接触不良导致内存通道初始化失败|校正针脚并重新安装散热器，正常开机|接口类||2025-02-20|',
  '戴尔|R750|中兴|进不去系统，报PXE启动失败|启动模式被改成UEFI而系统是Legacy安装|改回Legacy启动模式后正常进入系统|固件类||2025-03-11|',
  '戴尔|R750|中国移动|运行中蓝屏，MCE日志指向CPU，风扇狂转|CPU供电VRM电容失效，供电纹波过大|更换主板后连续烤机8小时无异常|CPU供电类|主板|2025-04-17|',
  '惠普|DL380 Gen10|中国联通|开机风扇转一下就停，反复循环|主板进入保护，排查发现PCIe转接板短路|拆除故障转接板后正常开机|供电类|PCIe转接板|2025-05-09|',
  '惠普|DL380 Gen10|华为|内存报错，可用内存容量减少|一条内存物理损坏，通道降级运行|更换损坏内存，容量恢复|内存类|内存条|2025-06-12|',
  '浪潮|NF5280M5|中国电信|CMOS丢失，每次断电系统时间归零|纽扣电池失效且CMOS跳线接触不良|更换电池并修复跳线|其他|CMOS电池|2025-07-23|',
  '华为|2288H V5|华为|无法开机，面板故障灯亮|电源背板连接器氧化导致供电不稳定|清洁并重插背板连接器|接口类||2025-08-19|',
  '联想|SR650|中国移动|温度过高自动关机，风扇满转|散热器积灰严重且导热硅脂干裂|清灰并重新涂抹硅脂，温度恢复正常|散热类|硅脂|2025-09-15|',
  '联想|SR650|华为|开机不显示，报CPU过温|CPU散热器扣具松动导致接触不良|重新安装扣具并涂硅脂|散热类||2025-10-21|',
  '联想|SR650|华为|开机无显示，风扇满转|电源模块12V输出异常，单路电源老化导致供电不足，主板自检未通过|更换故障电源模块，烤机4小时无异常|供电类|电源模块|2025-11-06|故意与第1条同型号同客户同现象，用于验证导入去重提示',
  '戴尔|R740|中兴|开机无图像输出，风扇拉满|CPU供电MOS管击穿导致主板供电异常|更换主板后开机正常|CPU供电类|主板|2025-12-02|故意与第4条近似，用于验证导入去重提示',
  '曙光|I840 G2|某超算中心|运行中降频，温度告警|进风口温度传感器漂移，误报高温触发降频保护|更换温度传感器，降频告警消失|散热类|温度传感器|2026-01-13|',
  '宝德|PR2705|某集成商|上电没有画面输出，主板故障灯亮|主板南桥供电电路异常|更换主板后正常|供电类|主板|2026-02-18|',
  '联想|SR650|华为|指示灯异常，硬盘灯不亮阵列卡报掉盘|背板供电线束松动|重插线束并做固定，阵列恢复正常|接口类||2026-03-06|',
  '戴尔|R740|华为|开机不显示，BMC报PCIe卡故障|Riser卡金手指氧化|清洁金手指并更换插槽|接口类||2026-04-10|',
  '浪潮|NF5280M6|中国电信|蓝屏频繁，内存测试报错|混用不同品牌不同频率内存导致兼容性异常|统一内存规格后通过测试|内存类||2026-05-14|',
  '华为|2288H V6|中国移动|风扇噪音异常，转速忽高忽低|BMC风扇策略被自定义脚本改乱|恢复默认风扇策略并刷新固件|固件类||2026-06-09|',
  '惠普|DL360 Gen10|中兴|无法开机，电源键指示灯不亮|双电源同批次老化同时损坏|更换两个电源模块|供电类|电源模块|2026-07-15|',
  '联想|SR650|中国联通|开机无显示，风扇全速运转|主板供电时序异常，上电自检停在CPU供电阶段|更换主板后正常|供电类|主板|2026-08-20|',
];

export interface SeedReport {
  symptoms: number;
  modelAliases: number;
  models: number;
  customers: number;
  cases: number;
  /** 第 17 轮：非首次建库跳过播种时为 true */
  skipped?: boolean;
  /** app_meta 里的播种标记值，便于启动日志核对 */
  marker?: string;
}

export function seedDictionary(): Pick<SeedReport, 'symptoms' | 'modelAliases'> {
  let symptoms = 0;
  let modelAliases = 0;
  const insertSymptom = db.prepare('INSERT OR IGNORE INTO symptom_dict (standard, aliases, category) VALUES (?, ?, ?)');
  const insertAlias = db.prepare('INSERT OR IGNORE INTO model_alias (canonical, alias) VALUES (?, ?)');
  db.transaction(() => {
    for (const s of SYMPTOM_SEEDS) {
      symptoms += insertSymptom.run(s.standard, s.aliases, s.category || '').changes;
    }
    for (const m of MODEL_ALIAS_SEEDS) {
      for (const alias of m.aliases.split(',').map((x) => x.trim()).filter(Boolean)) {
        modelAliases += insertAlias.run(m.canonical, alias).changes;
      }
    }
  })();
  return { symptoms, modelAliases };
}

function findOrCreateModel(brand: string, model: string, models: { id: number; brand: string; model: string }[]): number {
  const found = models.find((m) => m.model === model && m.brand === brand);
  if (found) return found.id;
  const info = db.prepare('INSERT INTO models (brand, model, platform, note) VALUES (?, ?, ?, ?)').run(brand, model, '', '种子数据自动创建');
  const id = Number(info.lastInsertRowid);
  models.push({ id, brand, model });
  return id;
}

function findOrCreateCustomer(name: string, customers: { id: number; name: string }[]): number | null {
  if (!name) return null;
  const found = customers.find((c) => c.name === name);
  if (found) return found.id;
  const info = db.prepare('INSERT INTO customers (name, contact, note) VALUES (?, ?, ?)').run(name, '', '种子数据自动创建');
  const id = Number(info.lastInsertRowid);
  customers.push({ id, name });
  return id;
}

const SEED_AUTHOR = '系统';

export function seedCases(): Pick<SeedReport, 'models' | 'customers' | 'cases'> {
  const models = db.prepare('SELECT id, brand, model FROM models').all() as { id: number; brand: string; model: string }[];
  const customers = db.prepare('SELECT id, name FROM customers').all() as { id: number; name: string }[];
  // 幂等键含维修日期：同一机器同一故障但不同维修日期视为返修/复发，正常入库
  const exists = db.prepare(
    'SELECT 1 FROM cases WHERE model = ? AND customer = ? AND symptom = ? AND repaired_at IS ? LIMIT 1'
  );
  const insert = db.prepare(
    `INSERT INTO cases
     (model, customer, symptom, diagnosis, solution, parts, note, repaired_at, source, category, status, author,
      model_id, customer_id, reviewer, reviewed_at, reject_reason, import_batch_no)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sample', ?, 'approved', ?, ?, ?, ?, datetime('now','localtime'), '', 'SEED')`
  );
  let modelsAdded = 0;
  let customersAdded = 0;
  let casesAdded = 0;

  const beforeModels = models.length;
  const beforeCustomers = customers.length;

  db.transaction(() => {
    for (const line of CASE_SEEDS) {
      const cols = line.split('|');
      const [brand, model, customer, symptom, diagnosis, solution, category, parts, repairedAt, note] = cols;
      const repaired = repairedAt || null;
      if (exists.get(model, customer, symptom, repaired)) continue;
      const modelBefore = models.length;
      const customerBefore = customers.length;
      const modelId = findOrCreateModel(brand, model, models);
      const customerId = findOrCreateCustomer(customer, customers);
      if (models.length > modelBefore) modelsAdded++;
      if (customers.length > customerBefore) customersAdded++;
      insert.run(
        model,
        customer,
        symptom,
        diagnosis,
        solution,
        parts,
        note,
        repaired,
        category,
        SEED_AUTHOR,
        modelId,
        customerId,
        SEED_AUTHOR
      );
      casesAdded++;
    }
  })();

  void modelsAdded;
  void customersAdded;
  void beforeModels;
  void beforeCustomers;

  return {
    models: models.length - beforeModels,
    customers: customers.length - beforeCustomers,
    cases: casesAdded,
  };
}

export function runSeedAll(): SeedReport {
  const dict = seedDictionary();
  const cases = seedCases();
  return { ...dict, ...cases };
}
