const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const { isIPv4 } = require('net');
const fs = require('fs');

const app = express();
app.use(bodyParser.json());

let allowedIPs = [];

const jenkinsServer = "http://SERVER:8080";

// Function to fetch and update allowed IP addresses from the given URL
const updateAllowedIPs = async () => {
  try {
    const response = await axios.get('https://ip-ranges.atlassian.com/');
    const ipRanges = response.data.items;
    allowedIPs = ipRanges.reduce((ips, item) => {
      // Assuming 'cidr' property contains IP address in CIDR format
      if (item.cidr) {
        ips.push(item.cidr);
      }
      return ips;
    }, []);
    console.log('Allowed IPs updated:', allowedIPs);
    logToFile('Allowed IPs updated');
  } catch (error) {
    console.error('Error fetching allowed IPs:', error.message);
    logToFile('Error fetching allowed IPs:', error.message);
  }
};

// Initial update of allowed IP addresses
updateAllowedIPs();

// Schedule periodic updates of allowed IP addresses (every 24 hours)
setInterval(updateAllowedIPs, 24 * 60 * 60 * 1000);

app.post('/bitbucket-webhook', async (req, res) => {
  try {
    let clientIP = req.ip; // Get the IP address of the client making the request

    // Get the original client's IP address from X-Forwarded-For header
    // This is when using ngrok for testing purposes only
    clientIP = req.headers['x-forwarded-for'] || req.ip;
    console.log(clientIP);
    logToFile('Request IP:', clientIP);

    // Check if the client's IP is in the allowedIPs array
    if (allowedIPs.some(ipRange => checkIPInCIDR(clientIP, ipRange))) {
      try {
        const queryParams = req.query; // Extract query parameters from the incoming request
        const queryStr = new URLSearchParams(queryParams).toString(); // Convert query parameters to a query string

        console.log(queryStr);
        logToFile('Projectg called:', queryStr);

        // Forward the incoming request to the Jenkins server using axios
        const jenkinsResponse = await axios.post(`${jenkinsServer}/generic-webhook-trigger/invoke?${queryStr}`, req.body, {
          headers: {
            'Content-Type': 'application/json',
          },
        });

        // Log the response from Jenkins
        console.log(jenkinsResponse.data);
        logToFile(jenkinsResponse.data);

        // Process the webhook data and forward it to Jenkins or perform other actions
        res.status(200).send('Webhook received successfully');
      } catch (error) {
        console.error(error);
        logToFile('Error forwarding request to Jenkins', error);
        res.status(500).send('Error forwarding request to Jenkins');
      }
    } else {
      // If the client's IP is not in the allowedIPs array, reject the request
      res.status(403).send('Forbidden: Access Denied');
    }
  } catch (error) {
    console.error(error);
    res.status(500).send('Error handling request');
    logToFile('Error handling request', error);
  }
});

// Function to check if an IP address belongs to a CIDR range
function checkIPInCIDR(ip, cidr) {
  const [subnet, bits] = cidr.split('/');
  const mask = ~(2 ** (32 - bits) - 1);
  const subnetInt = ipToInt(subnet) & mask;
  const ipInt = ipToInt(ip);

  // Some requests comes from an IPv4 IP, the validation has to be different
  if (isIPv4(ip)) {
    return (subnetInt & mask) === (ipInt & mask);
  }

  return subnetInt === ipInt & mask;
}

// Function to convert IP address to integer
function ipToInt(ip) {
  return ip.split('.').reduce((acc, octet, index, array) => {
    return acc + parseInt(octet) * 256 ** (array.length - index - 1);
  }, 0);
}

// Function to log messages to a log file
function logToFile(message) {
  // Get the current date and time
  const timestamp = new Date().toISOString();
  // Create a log entry with timestamp and message
  const logEntry = `[${timestamp}] ${message}\n`;

  // Append the log entry to the log file
  fs.appendFile('logfile.txt', logEntry, (err) => {
    if (err) {
      console.error('Error writing to log file:', err);
    } else {
      console.log('Message logged to file:', message);
    }
  });
}

app.listen(62200, () => {
  console.log('Server listening on port 62200');
  logToFile('Server listening on port 62200');
});
