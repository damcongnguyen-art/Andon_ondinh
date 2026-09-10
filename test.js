const axios = require('axios');
axios.get('https://andon-vn.aristongroup.com/msg_line?LineId=7')
  .then(res => console.log('Status:', res.status, 'Length:', res.data.length))
  .catch(err => console.error('Error:', err.message));
