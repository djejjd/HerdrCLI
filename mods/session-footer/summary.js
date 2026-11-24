import {quotaReadings} from './model.js';

export function summary(bill,card) {
  const readings = card ? quotaReadings(card) : [];
  const balance = readings.find(row => row.label === '余额');
  const windows = readings.filter(row => row !== balance).sort((first,second) => parseFloat(first.value)-parseFloat(second.value));
  const account = balance || windows[0];
  const label = row => row.label === '余额' ? '余额' : ({'5h':'5 小时','周':'本周'}[row.label] || row.label)+'剩';
  const fee = Number.isFinite(bill?.amount) ? '本会话 $'+bill.amount.toFixed(2)+(bill.pending || bill.partial ? ' 起' : '')
    : !bill ? '' : bill.pending ? '费用待定价' : windows.length && !balance ? '订阅已包含' : '暂无费用记录';
  return {fee,line:account ? fee+' · '+label(account)+' '+account.value : fee,readings:readings.map(row=>({...row,label:label(row)}))};
}
