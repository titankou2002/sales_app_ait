/**
 * 🔐 自動產生：所有前端會呼叫的後端功能外殼 (2026-09-30 v2)。
 * 原函式已改名 xxx_impl_；這裡的同名函式先經過 _aitCall_ (Auth.js) 驗證登入、權限，再執行並寫操作記錄。
 * 新增前端要呼叫的後端功能時：原函式取名 xxx_impl_，在這裡加一行外殼並在 AIT_SPECS 登記權限等級 (open/staff/admin/king/sys)。
 */
var AIT_SPECS = {
  aitPing: { tier: 'staff' }, // 使用時間回報 (不寫操作記錄)
  getClientFullData: { tier: 'open' },
  logExternalClientSearch: { tier: 'open' },
  verifyClientDirectAccess: { tier: 'open' },
  verifyClientMember: { tier: 'open' },
  getFolderImages: { tier: 'open' }, // 客戶端商品圖庫也會用 (只有商品圖片)
  dailyAutoSync: { tier: 'sys' },
  prewarmAllCaches: { tier: 'sys' },
  processLineBotQueue: { tier: 'sys' },
  runAllPreWarm: { tier: 'sys' },
  sendDailyAdminSummary: { tier: 'sys' },
  sendMissingCheckoutReminders: { tier: 'sys' },
  addCustomerToZoning: { tier: 'staff', label: '加入業務分區' },
  addDisplayNote: { tier: 'staff', label: '新增版面備註' },
  aiAssistantAsk: { tier: 'staff', label: 'AI 查詢' },
  completeSalesDeliveryTask: { tier: 'staff', label: '業務配送完成' },
  completeSampleTask: { tier: 'staff', label: '樣品任務完成' },
  createReservation: { tier: 'staff', label: '建立保留單' },
  deleteDisplayBatchPermanent: { tier: 'staff', label: '永久刪除版面' },
  deleteDrivingRecord: { tier: 'staff', label: '刪除行車記錄' },
  deleteWorkLogEntry: { tier: 'staff', label: '刪除工作日誌' },
  generateAttendanceReport: { tier: 'staff', label: '產生出勤報表' },
  getAggregatedInventory: { tier: 'staff' },
  getAttendanceReport: { tier: 'staff' },
  getCustomerAnalysisDetail: { tier: 'staff' },
  getCustomerAnalysisListForSales: { tier: 'staff' },
  getCustomerAnalysisSnapshot: { tier: 'staff' },
  getCustomerDisplays: { tier: 'staff' },
  getCustomerList: { tier: 'staff' },
  getCustomerSampleInfo: { tier: 'staff' },
  getCustomerVisitRanking: { tier: 'staff' },
  getCustomerYoyVisitMatrix: { tier: 'staff' },
  getDailyReportData: { tier: 'staff' },
  getDeliveryBonusData: { tier: 'staff' },
  getDisplayNotes: { tier: 'staff' },
  getDrivingHistory: { tier: 'staff' },
  getFieldWorkSummary: { tier: 'staff' },

  getFullMaintenanceHistory: { tier: 'staff' },
  getFwSettings: { tier: 'staff' },
  getIncomingCargoContainers: { tier: 'staff' },
  getInventoryLightData: { tier: 'staff' },
  getLastOdometer: { tier: 'staff' },
  getLatestLayoutActivities: { tier: 'staff' },
  getLatestStockoutEntries: { tier: 'staff' },
  getMaintenanceHistory: { tier: 'staff' },
  getSalesCustomers: { tier: 'staff' },
  getSalesDeliveryTaskCount: { tier: 'staff' },
  getSalesDeliveryTasks: { tier: 'staff' },
  getSalesHistoryReport: { tier: 'staff' },
  getSalesList: { tier: 'staff' },
  getSalesOverview: { tier: 'staff' },
  getSalesPerformanceData: { tier: 'staff' },
  getSalespersonKpi: { tier: 'staff' },
  getSeriesNameSuggestions: { tier: 'staff' },
  getSeriesSkuOptions: { tier: 'staff' },
  getShelfSalesRows: { tier: 'staff' },
  getShelfTrackingData: { tier: 'staff' },
  getSkuImageMap: { tier: 'staff' },
  getSkuReservations: { tier: 'staff' },
  getSleeperDetails: { tier: 'staff' },
  getTodayLogs: { tier: 'staff' },
  getTodayStatus: { tier: 'staff' },
  getUserReservations: { tier: 'staff' },
  getWorkLogHistory: { tier: 'staff' },
  getWorkLogMonthDates: { tier: 'staff' },
  logSalespersonSearch: { tier: 'staff' },
  offShelfDisplayBatch: { tier: 'staff', label: '下架版面' },
  saveAttendance: { tier: 'staff', label: '外勤打卡' },
  saveDrivingFuelRecord: { tier: 'staff', label: '行車／加油記錄' },
  saveMaintenanceRecord: { tier: 'staff', label: '車輛保養記錄' },
  saveNewLayout: { tier: 'staff', label: '建立上架版面' },
  saveWorkLogBatch: { tier: 'staff', label: '儲存工作日誌' },
  sendLayoutReport: { tier: 'staff', label: '寄送版面報告' },
  setCustomerVisibility: { tier: 'staff', label: '顯示／隱藏客戶' },
  setSleeperAnnualTarget: { tier: 'staff', label: '設定年度目標' },
  submitLeaveRequest: { tier: 'staff', label: '請假申請' },
  transferSalesDeliveryTask: { tier: 'staff', label: '轉交配送任務' },
  updateDisplayBatch: { tier: 'staff', label: '更新陳列' },
  updateDrivingRecord: { tier: 'staff', label: '修改行車記錄' },
  updateLayoutFieldBatch: { tier: 'staff', label: '更新版面欄位' },
  updateReservedStatus: { tier: 'staff', label: '更新保留狀態' },
  updateWorkLog: { tier: 'staff', label: '修改工作日誌' },
  uploadFwOnlinePhoto: { tier: 'staff', label: '上傳外勤照片', noArgs: true },
  verifySalesKey: { tier: 'staff' },
  getAllSalesDailyReports: { tier: 'admin' },
  getOmniscientLogs: { tier: 'admin' },
  addDirectSalesperson: { tier: 'king', label: '新增直達同仁' },
  addLeaveRecord: { tier: 'king', label: '新增請假' },
  addOrBatchClients: { tier: 'king', label: '新增客戶白名單' },
  addOrBatchLineClients: { tier: 'king', label: '新增 LINE 客戶' },
  aitKeysPageHtml: { tier: 'king', label: '開啟機密中心' },
  calcMonthlySalary: { tier: 'king', label: '計算月薪', noArgs: true },
  deleteAttendanceStaff: { tier: 'king', label: '刪除出勤員工' },
  deleteDirectSalesperson: { tier: 'king', label: '刪除直達同仁' },
  enableDirectSalesperson: { tier: 'king', label: '啟用直達連結' },
  exportBonusRangeToExcel: { tier: 'king', label: '匯出獎金 Excel' },
  getActiveBonusConfig: { tier: 'king' },
  getAdminBonusReport: { tier: 'king', label: '查看獎金報表' },
  getAttendanceStaffList: { tier: 'king' },
  getLeaveBalance: { tier: 'king' },
  getLeaveList: { tier: 'king' },
  getMonthlyAttendance: { tier: 'king', label: '查看出勤' },
  getRaiseRecords: { tier: 'king' },
  getTodayAttendance: { tier: 'king' },
  recalcLeaveBalance: { tier: 'king', label: '重算假期餘額' },
  removeClientFromWhitelist: { tier: 'king', label: '移除客戶白名單' },
  removeLineClientFromWhitelist: { tier: 'king', label: '移除 LINE 客戶' },
  revokeDirectSalesperson: { tier: 'king', label: '停用直達連結' },
  saveActiveBonusConfig: { tier: 'king', label: '修改獎金設定' },
  saveAttendanceStaff: { tier: 'king', label: '儲存出勤員工' },
  savePunchRecord: { tier: 'king', label: '補登打卡' },
  saveSalarySlips: { tier: 'king', label: '儲存薪資單', noArgs: true },
  saveSalesBonusRow: { tier: 'king', label: '修改業務獎金' },
  updateLeaveBalance: { tier: 'king', label: '調整假期餘額' },
  updateLeaveBalanceFull: { tier: 'king', label: '調整假期餘額' },
  updateLeaveStatus: { tier: 'king', label: '審核請假' },
  updateSalaryRow: { tier: 'king', label: '修改薪資' }
};

function addCustomerToZoning() { return _aitCall_('addCustomerToZoning', addCustomerToZoning_impl_, arguments); }
function addDirectSalesperson() { return _aitCall_('addDirectSalesperson', addDirectSalesperson_impl_, arguments); }
function addDisplayNote() { return _aitCall_('addDisplayNote', addDisplayNote_impl_, arguments); }
function addLeaveRecord() { return _aitCall_('addLeaveRecord', addLeaveRecord_impl_, arguments); }
function addOrBatchClients() { return _aitCall_('addOrBatchClients', addOrBatchClients_impl_, arguments); }
function addOrBatchLineClients() { return _aitCall_('addOrBatchLineClients', addOrBatchLineClients_impl_, arguments); }
function aiAssistantAsk() { return _aitCall_('aiAssistantAsk', aiAssistantAsk_impl_, arguments); }
function aitKeysPageHtml() { return _aitCall_('aitKeysPageHtml', aitKeysPageHtml_impl_, arguments); }
function calcMonthlySalary() { return _aitCall_('calcMonthlySalary', calcMonthlySalary_impl_, arguments); }
function completeSalesDeliveryTask() { return _aitCall_('completeSalesDeliveryTask', completeSalesDeliveryTask_impl_, arguments); }
function completeSampleTask() { return _aitCall_('completeSampleTask', completeSampleTask_impl_, arguments); }
function createReservation() { return _aitCall_('createReservation', createReservation_impl_, arguments); }
function dailyAutoSync() { return _aitCall_('dailyAutoSync', dailyAutoSync_impl_, arguments); }
function deleteAttendanceStaff() { return _aitCall_('deleteAttendanceStaff', deleteAttendanceStaff_impl_, arguments); }
function deleteDirectSalesperson() { return _aitCall_('deleteDirectSalesperson', deleteDirectSalesperson_impl_, arguments); }
function deleteDisplayBatchPermanent() { return _aitCall_('deleteDisplayBatchPermanent', deleteDisplayBatchPermanent_impl_, arguments); }
function deleteDrivingRecord() { return _aitCall_('deleteDrivingRecord', deleteDrivingRecord_impl_, arguments); }
function deleteWorkLogEntry() { return _aitCall_('deleteWorkLogEntry', deleteWorkLogEntry_impl_, arguments); }
function enableDirectSalesperson() { return _aitCall_('enableDirectSalesperson', enableDirectSalesperson_impl_, arguments); }
function exportBonusRangeToExcel() { return _aitCall_('exportBonusRangeToExcel', exportBonusRangeToExcel_impl_, arguments); }
function generateAttendanceReport() { return _aitCall_('generateAttendanceReport', generateAttendanceReport_impl_, arguments); }
function getActiveBonusConfig() { return _aitCall_('getActiveBonusConfig', getActiveBonusConfig_impl_, arguments); }
function getAdminBonusReport() { return _aitCall_('getAdminBonusReport', getAdminBonusReport_impl_, arguments); }
function getAggregatedInventory() { return _aitCall_('getAggregatedInventory', getAggregatedInventory_impl_, arguments); }
function getAllSalesDailyReports() { return _aitCall_('getAllSalesDailyReports', getAllSalesDailyReports_impl_, arguments); }
function getAttendanceReport() { return _aitCall_('getAttendanceReport', getAttendanceReport_impl_, arguments); }
function getAttendanceStaffList() { return _aitCall_('getAttendanceStaffList', getAttendanceStaffList_impl_, arguments); }
function getClientFullData() { return _aitCall_('getClientFullData', getClientFullData_impl_, arguments); }
function getCustomerAnalysisDetail() { return _aitCall_('getCustomerAnalysisDetail', getCustomerAnalysisDetail_impl_, arguments); }
function getCustomerAnalysisListForSales() { return _aitCall_('getCustomerAnalysisListForSales', getCustomerAnalysisListForSales_impl_, arguments); }
function getCustomerAnalysisSnapshot() { return _aitCall_('getCustomerAnalysisSnapshot', getCustomerAnalysisSnapshot_impl_, arguments); }
function getCustomerDisplays() { return _aitCall_('getCustomerDisplays', getCustomerDisplays_impl_, arguments); }
function getCustomerList() { return _aitCall_('getCustomerList', getCustomerList_impl_, arguments); }
function getCustomerSampleInfo() { return _aitCall_('getCustomerSampleInfo', getCustomerSampleInfo_impl_, arguments); }
function getCustomerVisitRanking() { return _aitCall_('getCustomerVisitRanking', getCustomerVisitRanking_impl_, arguments); }
function getCustomerYoyVisitMatrix() { return _aitCall_('getCustomerYoyVisitMatrix', getCustomerYoyVisitMatrix_impl_, arguments); }
function getDailyReportData() { return _aitCall_('getDailyReportData', getDailyReportData_impl_, arguments); }
function getDeliveryBonusData() { return _aitCall_('getDeliveryBonusData', getDeliveryBonusData_impl_, arguments); }
function getDisplayNotes() { return _aitCall_('getDisplayNotes', getDisplayNotes_impl_, arguments); }
function getDrivingHistory() { return _aitCall_('getDrivingHistory', getDrivingHistory_impl_, arguments); }
function getFieldWorkSummary() { return _aitCall_('getFieldWorkSummary', getFieldWorkSummary_impl_, arguments); }
function getFolderImages() { return _aitCall_('getFolderImages', getFolderImages_impl_, arguments); }
function getFullMaintenanceHistory() { return _aitCall_('getFullMaintenanceHistory', getFullMaintenanceHistory_impl_, arguments); }
function getFwSettings() { return _aitCall_('getFwSettings', getFwSettings_impl_, arguments); }
function getIncomingCargoContainers() { return _aitCall_('getIncomingCargoContainers', getIncomingCargoContainers_impl_, arguments); }
function getInventoryLightData() { return _aitCall_('getInventoryLightData', getInventoryLightData_impl_, arguments); }
function getLastOdometer() { return _aitCall_('getLastOdometer', getLastOdometer_impl_, arguments); }
function getLatestLayoutActivities() { return _aitCall_('getLatestLayoutActivities', getLatestLayoutActivities_impl_, arguments); }
function getLatestStockoutEntries() { return _aitCall_('getLatestStockoutEntries', getLatestStockoutEntries_impl_, arguments); }
function getLeaveBalance() { return _aitCall_('getLeaveBalance', getLeaveBalance_impl_, arguments); }
function getLeaveList() { return _aitCall_('getLeaveList', getLeaveList_impl_, arguments); }
function getMaintenanceHistory() { return _aitCall_('getMaintenanceHistory', getMaintenanceHistory_impl_, arguments); }
function getMonthlyAttendance() { return _aitCall_('getMonthlyAttendance', getMonthlyAttendance_impl_, arguments); }
function getOmniscientLogs() { return _aitCall_('getOmniscientLogs', getOmniscientLogs_impl_, arguments); }
function getRaiseRecords() { return _aitCall_('getRaiseRecords', getRaiseRecords_impl_, arguments); }
function getSalesCustomers() { return _aitCall_('getSalesCustomers', getSalesCustomers_impl_, arguments); }
function getSalesDeliveryTaskCount() { return _aitCall_('getSalesDeliveryTaskCount', getSalesDeliveryTaskCount_impl_, arguments); }
function getSalesDeliveryTasks() { return _aitCall_('getSalesDeliveryTasks', getSalesDeliveryTasks_impl_, arguments); }
function getSalesHistoryReport() { return _aitCall_('getSalesHistoryReport', getSalesHistoryReport_impl_, arguments); }
function getSalesList() { return _aitCall_('getSalesList', getSalesList_impl_, arguments); }
function getSalesOverview() { return _aitCall_('getSalesOverview', getSalesOverview_impl_, arguments); }
function getSalesPerformanceData() { return _aitCall_('getSalesPerformanceData', getSalesPerformanceData_impl_, arguments); }
function getSalespersonKpi() { return _aitCall_('getSalespersonKpi', getSalespersonKpi_impl_, arguments); }
function getSeriesNameSuggestions() { return _aitCall_('getSeriesNameSuggestions', getSeriesNameSuggestions_impl_, arguments); }
function getSeriesSkuOptions() { return _aitCall_('getSeriesSkuOptions', getSeriesSkuOptions_impl_, arguments); }
function getShelfSalesRows() { return _aitCall_('getShelfSalesRows', getShelfSalesRows_impl_, arguments); }
function getShelfTrackingData() { return _aitCall_('getShelfTrackingData', getShelfTrackingData_impl_, arguments); }
function getSkuImageMap() { return _aitCall_('getSkuImageMap', getSkuImageMap_impl_, arguments); }
function getSkuReservations() { return _aitCall_('getSkuReservations', getSkuReservations_impl_, arguments); }
function getSleeperDetails() { return _aitCall_('getSleeperDetails', getSleeperDetails_impl_, arguments); }
function getTodayAttendance() { return _aitCall_('getTodayAttendance', getTodayAttendance_impl_, arguments); }
function getTodayLogs() { return _aitCall_('getTodayLogs', getTodayLogs_impl_, arguments); }
function getTodayStatus() { return _aitCall_('getTodayStatus', getTodayStatus_impl_, arguments); }
function getUserReservations() { return _aitCall_('getUserReservations', getUserReservations_impl_, arguments); }
function getWorkLogHistory() { return _aitCall_('getWorkLogHistory', getWorkLogHistory_impl_, arguments); }
function getWorkLogMonthDates() { return _aitCall_('getWorkLogMonthDates', getWorkLogMonthDates_impl_, arguments); }
function logExternalClientSearch() { return _aitCall_('logExternalClientSearch', logExternalClientSearch_impl_, arguments); }
function logSalespersonSearch() { return _aitCall_('logSalespersonSearch', logSalespersonSearch_impl_, arguments); }
function offShelfDisplayBatch() { return _aitCall_('offShelfDisplayBatch', offShelfDisplayBatch_impl_, arguments); }
function prewarmAllCaches() { return _aitCall_('prewarmAllCaches', prewarmAllCaches_impl_, arguments); }
function processLineBotQueue() { return _aitCall_('processLineBotQueue', processLineBotQueue_impl_, arguments); }
function recalcLeaveBalance() { return _aitCall_('recalcLeaveBalance', recalcLeaveBalance_impl_, arguments); }
function removeClientFromWhitelist() { return _aitCall_('removeClientFromWhitelist', removeClientFromWhitelist_impl_, arguments); }
function removeLineClientFromWhitelist() { return _aitCall_('removeLineClientFromWhitelist', removeLineClientFromWhitelist_impl_, arguments); }
function revokeDirectSalesperson() { return _aitCall_('revokeDirectSalesperson', revokeDirectSalesperson_impl_, arguments); }
function runAllPreWarm() { return _aitCall_('runAllPreWarm', runAllPreWarm_impl_, arguments); }
function saveActiveBonusConfig() { return _aitCall_('saveActiveBonusConfig', saveActiveBonusConfig_impl_, arguments); }
function saveAttendance() { return _aitCall_('saveAttendance', saveAttendance_impl_, arguments); }
function saveAttendanceStaff() { return _aitCall_('saveAttendanceStaff', saveAttendanceStaff_impl_, arguments); }
function saveDrivingFuelRecord() { return _aitCall_('saveDrivingFuelRecord', saveDrivingFuelRecord_impl_, arguments); }
function saveMaintenanceRecord() { return _aitCall_('saveMaintenanceRecord', saveMaintenanceRecord_impl_, arguments); }
function saveNewLayout() { return _aitCall_('saveNewLayout', saveNewLayout_impl_, arguments); }
function savePunchRecord() { return _aitCall_('savePunchRecord', savePunchRecord_impl_, arguments); }
function saveSalarySlips() { return _aitCall_('saveSalarySlips', saveSalarySlips_impl_, arguments); }
function saveSalesBonusRow() { return _aitCall_('saveSalesBonusRow', saveSalesBonusRow_impl_, arguments); }
function saveWorkLogBatch() { return _aitCall_('saveWorkLogBatch', saveWorkLogBatch_impl_, arguments); }
function sendDailyAdminSummary() { return _aitCall_('sendDailyAdminSummary', sendDailyAdminSummary_impl_, arguments); }
function sendLayoutReport() { return _aitCall_('sendLayoutReport', sendLayoutReport_impl_, arguments); }
function sendMissingCheckoutReminders() { return _aitCall_('sendMissingCheckoutReminders', sendMissingCheckoutReminders_impl_, arguments); }
function setCustomerVisibility() { return _aitCall_('setCustomerVisibility', setCustomerVisibility_impl_, arguments); }
function setSleeperAnnualTarget() { return _aitCall_('setSleeperAnnualTarget', setSleeperAnnualTarget_impl_, arguments); }
function submitLeaveRequest() { return _aitCall_('submitLeaveRequest', submitLeaveRequest_impl_, arguments); }
function transferSalesDeliveryTask() { return _aitCall_('transferSalesDeliveryTask', transferSalesDeliveryTask_impl_, arguments); }
function updateDisplayBatch() { return _aitCall_('updateDisplayBatch', updateDisplayBatch_impl_, arguments); }
function updateDrivingRecord() { return _aitCall_('updateDrivingRecord', updateDrivingRecord_impl_, arguments); }
function updateLayoutFieldBatch() { return _aitCall_('updateLayoutFieldBatch', updateLayoutFieldBatch_impl_, arguments); }
function updateLeaveBalance() { return _aitCall_('updateLeaveBalance', updateLeaveBalance_impl_, arguments); }
function updateLeaveBalanceFull() { return _aitCall_('updateLeaveBalanceFull', updateLeaveBalanceFull_impl_, arguments); }
function updateLeaveStatus() { return _aitCall_('updateLeaveStatus', updateLeaveStatus_impl_, arguments); }
function updateReservedStatus() { return _aitCall_('updateReservedStatus', updateReservedStatus_impl_, arguments); }
function updateSalaryRow() { return _aitCall_('updateSalaryRow', updateSalaryRow_impl_, arguments); }
function updateWorkLog() { return _aitCall_('updateWorkLog', updateWorkLog_impl_, arguments); }
function uploadFwOnlinePhoto() { return _aitCall_('uploadFwOnlinePhoto', uploadFwOnlinePhoto_impl_, arguments); }
function verifyClientDirectAccess() { return _aitCall_('verifyClientDirectAccess', verifyClientDirectAccess_impl_, arguments); }
function verifyClientMember() { return _aitCall_('verifyClientMember', verifyClientMember_impl_, arguments); }
function verifySalesKey() { return _aitCall_('verifySalesKey', verifySalesKey_impl_, arguments); }
function aitPing() { return _aitCall_('aitPing', aitPing_impl_, arguments); }
