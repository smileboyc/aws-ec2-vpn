const AWS = require('aws-sdk');

// 配置 AWS
AWS.config.update({
    accessKeyId: "AKIA5FTY75RDVI4CA2KD",
    secretAccessKey: "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",
    region: process.env.AWS_DEFAULT_REGION || 'ap-northeast-2',
});

// 创建 EC2 服务对象
const ec2 = new AWS.EC2();

// 删除 EC2 实例
async function terminateEC2Instance(instanceId) {
    const describeParams = {
        InstanceIds: [instanceId]
    };

    try {
        // 检查实例状态
        const describeResult = await ec2.describeInstances(describeParams).promise();
        const instanceState = describeResult.Reservations[0].Instances[0].State.Name;

        // 如果实例不处于 running 或 stopped 状态，则不能删除
        if (instanceState !== 'running' && instanceState !== 'stopped') {
            console.log(`Instance is in ${instanceState} state. Cannot terminate.`);
            return;
        }

        // 获取实例的终止保护设置
        const instance = describeResult.Reservations[0].Instances[0];
        if (instance.DisableApiTermination) {
            console.log('Termination protection is enabled. Disabling it first...');
            // 禁用终止保护
            const modifyParams = {
                InstanceId: instanceId,
                DisableApiTermination: false // 禁用终止保护
            };
            await ec2.modifyInstanceAttribute(modifyParams).promise();
            console.log('Termination protection disabled');
        }

        // 执行终止实例操作
        const terminateParams = {
            InstanceIds: [instanceId]
        };

        const terminateResult = await ec2.terminateInstances(terminateParams).promise();
        console.log('EC2 Instance terminated:', terminateResult);
    } catch (error) {
        console.error('Error terminating EC2 instance:', error.message);
        throw new Error('Failed to terminate EC2 instance');
    }
}

// 使用示例：假设你已经知道实例 ID，调用 terminateEC2Instance 方法
const instanceId = 'i-0aa97c1fcd3430dbd'; // 替换为你要删除的 EC2 实例 ID
terminateEC2Instance(instanceId);