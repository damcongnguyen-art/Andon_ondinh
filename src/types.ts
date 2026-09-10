export interface ProductMasterItem {
  id?: string;
  code: string; // e.g. "3195349"
  modelName: string; // e.g. "EASY 3.5"
  speedPerHour: number; // e.g. 70
  defaultLine?: string; // e.g. "ELI"
  defaultPlan?: number;
  puWeight?: string;
  tc?: string;
  notes?: string;
}

export interface LineSummaryItem {
  id: string;
  line: string;
  code: string;
  modelName: string;
  plan: number;
  actual: number;
  speedPerHour: number;
  gap: number; // actual - plan
  extra1?: string;
  extra2?: string;
  extra3?: string;
  extra4?: string;
}

export interface HourlyLogItem {
  id: string;
  puWeight: string;
  tc: string;
  manpower: number | string;
  modelCode: string;
  timeStart: string;
  timeEnd: string;
  sttStart: number | string;
  sttEnd: number | string;
  pcsPerHour: number | string;
  target: number | string;
  variance: number | string; // pcsPerHour - target (Âm/Dương)
  statusNote: string;
  pig?: string;
}

export interface AiAnalysisResult {
  summary: string;
  keyFindings: string[];
  recommendations: string[];
  efficiencyScore?: number;
  isAi?: boolean;
}

export interface DailyReportData {
  id?: string;
  reportDate: string;
  timeRange: string;
  teamName: string;
  manpower: number;
  picking: number;
  absent: number;
  borrowed: number;
  transferredSupport: number;
  totalManpower: number;
  totalUpperPlan?: number | string;
  totalUpperActual?: number | string;
  totalUpperGap?: number | string;
  totalHourlyPcs?: number | string;
  totalHourlyTarget?: number | string;
  totalHourlyVariance?: number | string;
  totalHourlyLabel?: string;
  totalHourlyStatus?: string;
  totalHourlyPig?: string;
  totalHourlyPU?: string;
  totalHourlyTC?: string;
  totalHourlyManpower?: string;
  totalHourlyModel?: string;
  totalHourlyTime?: string;
  totalHourlySTT?: string;
  extra1?: string;
  extra2?: string;
  extra3?: string;
  lineItems: LineSummaryItem[];
  hourlyLogs: HourlyLogItem[];
  aiAnalysis?: AiAnalysisResult;
  updatedAt?: string;
}
