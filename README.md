# naivechain
>简单的区块链实现
>***
>运行测试代码：
> - 1. 安装依赖
>> npm install
> - 2. Linux上启动三个bash，并切换到项目目录下执行分别执行如下代码：
>> - 第一个bash : $ HTTP_PORT=3001 P2P_PORT=6001 npm start
>> - 第二个bash : $ HTTP_PORT=3002 P2P_PORT=6002 PEERS=ws://localhost:6001 npm start
>> - 第三个bash : $ curl -H "Content-type:application/json" --data '{"data" : "ok"}' http://localhost:3001/mineBlock
> 注： 在第三个bash执行前需要确保安装了curl  $ apt-get install curl
