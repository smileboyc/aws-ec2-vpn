const express = require('express');
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

// 配置 AWS
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_DEFAULT_REGION || 'ap-northeast-2',
});

const ec2 = new AWS.EC2();
const s3 = new AWS.S3();
const BUCKET_NAME = 'guangze-public'; // 替换为你的 S3 存储桶名称

const router = express.Router();

// 监听 connectVPN 请求
router.get('/connectVPN', async (req, res) => {
    console.log('Received connectVPN request...');

    try {
        const instance = await createEC2InstanceAndGenerateConfig();

        res.json({
            message: 'VPN 创建成功并已生成二维码和配置文件。',
            publicIp:instance.publicIp,
            qrCodeUrl: instance.qrCodeUrl,
            clashConfigUrl: instance.clashConfigUrl,
        });
    } catch (error) {
        console.error('Error processing connectVPN request:', error.message);
        res.status(500).json({ error: 'VPN 创建失败，请稍后重试。' });
    }
});

// 上传文件到 S3
async function uploadToS3(localFilePath, s3Key) {
    try {
        const fileContent = fs.readFileSync(localFilePath);

        const params = {
            Bucket: BUCKET_NAME,
            Key: `VPN/${s3Key}`,
            Body: fileContent,
            ContentType: s3Key.endsWith('.png') ? 'image/png' : 'text/yaml',
            ACL: 'public-read',
        };

        const result = await s3.upload(params).promise();
        console.log(`File uploaded to S3: ${result.Location}`);
        return result.Location;
    } catch (error) {
        console.error('Error uploading to S3:', error.message);
        throw new Error('文件上传到 S3 失败');
    }
}

// 等待 EC2 分配公网 IP
async function waitForPublicIp(instanceId) {
    while (true) {
        const describeResult = await ec2.describeInstances({ InstanceIds: [instanceId] }).promise();
        const instance = describeResult.Reservations[0].Instances[0];
        if (instance.PublicIpAddress) {
            return instance.PublicIpAddress;
        }
        console.log('等待分配公网 IP...');
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}

// 创建 EC2 实例并生成 Clash 配置文件
async function createEC2InstanceAndGenerateConfig() {
    const userDataScript = `#!/bin/bash
    sudo apt update -y
    sudo apt install shadowsocks-libev -y
    sudo bash -c 'echo -e "{
        \\"server\\": \\"0.0.0.0\\",
        \\"server_port\\": 8377,
        \\"password\\": \\"123456\\",
        \\"method\\": \\"aes-256-gcm\\",
        \\"timeout\\": 300,
        \\"fast_open\\": false
    }" > /etc/shadowsocks.json'
    sudo ss-server -c /etc/shadowsocks.json > /var/log/shadowsocks.log 2>&1 &
    `;

    const params = {
        ImageId: 'ami-042e76978adeb8c48', // 替换为你的 AMI ID
        InstanceType: 't2.micro', // 替换为所需实例类型
        MinCount: 1,
        MaxCount: 1,
        KeyName: 'test', // 替换为你的 Key Pair 名称
        SecurityGroupIds: ['sg-0052f29930796e74c'], // 替换为你的安全组 ID
        UserData: Buffer.from(userDataScript).toString('base64'),
    };

    try {
        const result = await ec2.runInstances(params).promise();
        const instanceId = result.Instances[0].InstanceId;
        console.log('EC2 Instance Created:', instanceId);

        const publicIp = await waitForPublicIp(instanceId);
        console.log(`Public IP of EC2 Instance: ${publicIp}`);

        // 创建输出目录
        const outputDir = path.join(__dirname, 'output');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir);
        }

        // 生成 Clash 配置文件
        const clashFilePath = path.join(outputDir, `${publicIp}.yaml`);
        const clashConfig = `
port: 7890
socks-port: 7891
mixed-port: 7892
allow-lan: false
mode: rule

proxies:
  - name: "Shadowsocks Server"
    type: ss
    server: ${publicIp}
    port: 8377
    cipher: aes-256-gcm
    password: 123456

proxy-groups:
  - name: "Proxy"
    type: select
    proxies:
      - "Shadowsocks Server"

rules:
  - DOMAIN-SUFFIX,google.com,Proxy
  - DOMAIN-SUFFIX,youtube.com,Proxy
  - GEOIP,CN,DIRECT
  - MATCH,Proxy
`;
        fs.writeFileSync(clashFilePath, clashConfig);
        console.log(`Clash configuration saved to ${clashFilePath}`);

        // 生成二维码
        const qrCodePath = path.join(outputDir, `${publicIp}.png`);
        await generateQRCode(publicIp, 8377, '123456', 'aes-256-gcm', qrCodePath);

        // 上传到 S3
        const clashConfigUrl = await uploadToS3(clashFilePath, `${publicIp}.yaml`);
        const qrCodeUrl = await uploadToS3(qrCodePath, `${publicIp}.png`);

        return { publicIp, clashConfigUrl, qrCodeUrl };
    } catch (error) {
        console.error('Error creating EC2 instance:', error.message);
        throw new Error('EC2 实例创建失败');
    }
}

// 生成二维码
async function generateQRCode(server, port, password, method, outputPath) {
    const uri = `ss://${Buffer.from(`${method}:${password}@${server}:${port}`).toString('base64')}`;
    await QRCode.toFile(outputPath, uri);
    console.log(`二维码已生成并保存到: ${outputPath}`);
}

module.exports = router;
