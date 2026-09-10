import axios from 'axios';
axios.post('https://andon-vn.aristongroup.com/Mes_Msg_Statistic/Load_Msg_Line', 'LineId=7&checkPass=false', {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
}).then(res => {
  const data = res.data;
  if (data.DATA && data.DATA.MES_MSG_LINE_DETAIL && data.DATA.MES_MSG_LINE_DETAIL.length > 0) {
      console.log(JSON.stringify(data.DATA.MES_MSG_LINE_DETAIL[0], null, 2));
  }
}).catch(err => console.error(err.message));
