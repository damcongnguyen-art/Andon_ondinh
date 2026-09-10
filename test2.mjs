import axios from 'axios';
axios.post('https://andon-vn.aristongroup.com/Mes_Msg_Statistic/Load_Msg_Line', 'LineId=7&checkPass=false', {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
}).then(res => {
  const data = res.data;
  console.log(Object.keys(data));
  if (data.DATA) {
     console.log(Object.keys(data.DATA));
     if (data.DATA.MES_MSG_LINE_DETAIL) {
         console.log('MES_MSG_LINE_DETAIL:', JSON.stringify(data.DATA.MES_MSG_LINE_DETAIL, null, 2).substring(0, 500));
     }
  }
}).catch(err => console.error(err.message));
