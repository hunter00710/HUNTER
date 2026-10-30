// Entirely synthetic. No customer PO, bank reference, payable or real contract amount.
export function fixture(){return {
 D:{source:'synthetic',fileDate:'2026-10-20',reviewDate:'2026-10-30',currency:'TWD',orders:[
  {po:'DEMO-001',name:'Synthetic machine A',buyer:'Test',category:'設備',amount:10000,monthly:{paidSource:2000,balanceSource:8000,schedule:[]}},
  {po:'DEMO-002',name:'Synthetic machine B',buyer:'Test',category:'設備',amount:5000,monthly:{paidSource:0,balanceSource:5000,schedule:[]}},
  {po:'DEMO-UNKNOWN',name:'Unknown opening balance',buyer:'Test',category:'設備',amount:1000}
 ],issues:[],periods:[],raw:[],formulaChecks:[],totals:{}},
 eagle:{source:'synthetic',asof:'2026-10-26',records:[{id:'DEMO-AP-1',customer:'Synthetic',name:'Synthetic machine',currency:'USD',po:'DEMO-001',total:3000,paid:500,schedules:[]}],issues:[],raw:[],formulaChecks:[]},
 asof:'2026-10-30'
};}
