# Pulumi AI

Create cloud infrastructure with Pulumi Automation API ☁️ and OpenAI GPT 🤖.  Try out Pulumi AI online at https://pulumi.com/ai, or locally with `npx pulumi-ai`.

> _Note_: This is an experimental AI experience for interactively building cloud infrastructure using GPT.  It will likely do surprising and interesting things, and will make mistakes!  You have the option to provide access to deploy infrastructure directly into your cloud account(s), which puts incredible power in the hands of the AI, be sure to use with approporiate caution.

![Demo of Pulumi AI](assets/demo.gif)

## Running

To use the CLI tool, you must configure the following:
* Download and install [`pulumi`](https://www.pulumi.com/docs/get-started/install/).
* Get an [OpenAI API Key](https://platform.openai.com/account/api-keys) and make it available as `OPENAI_API_KEY`.
* Login to Pulumi via `pulumi login`, or else by exporting a Pulumi Access Token as `PULUMI_ACCESS_TOKEN`.
* Configure your cloud credentials for your target Cloud environment ([AWS](https://www.pulumi.com/registry/packages/aws/installation-configuration/), [Azure](https://www.pulumi.com/registry/packages/azure-native/installation-configuration/), [Google Cloud](https://www.pulumi.com/registry/packages/gcp/installation-configuration/), [Kubernetes](https://www.pulumi.com/registry/packages/kubernetes/installation-configuration/), etc.).

> _Note_: The `pulumi-ai` CLI works best with AWS today, but can be used with any cloud.

Then run:

```bash
npx pulumi-ai
```

You can ask for any infrastructure you want, then use these commands to take actions outside of interacting with the AI:
* `!quit`: Exit the AI and cleanup the temporary stack.
* `!program`:  See the Pulumi program that has been developed so far.
* `!stack`: See details of the Pulumi stack that has been deployed so far.
* `!verbose`: Turn verbose mode on for debugging interactions with GPT and Pulumi.
* `!open <output>`: Open a URL from the given stack output name in the system browser.

The following environment variables are also available to configure the GPT AI used:
* `OPENAI_MODEL`: Select one of the valid [OpenAI Models](https://platform.openai.com/docs/models), suchas as `gpt-4` (default, and most accurate but slow) or `gpt-3.5-turbo` (not as accurate but much faster).
* `OPENAI_TEMPERATURE`: Configure the temperature to tune the AI to be more predicatable (lower values) or more creative (higher values).

## Examples

```
Welcome to Pulumi AI.

Your stack: https://app.pulumi.com/luke/pulumi-ai/dev/resources

What cloud infrastructure do you want to build today?

> An AWS VPC
create aws:ec2/vpc:Vpc my-vpc ...
created my-vpc
vpcCidrBlock: 10.0.0.0/16
vpcId: vpc-016f35c7f078ab9e8

> Add three private subnets
create aws:ec2/subnet:Subnet private-subnet-2-2 ...
create aws:ec2/subnet:Subnet private-subnet-1-1 ...
create aws:ec2/subnet:Subnet private-subnet-3-3 ...
created private-subnet-2-2
created private-subnet-3-3
created private-subnet-1-1
privateSubnetIds: subnet-08add1c8ae97e3cfb,subnet-0cb4ea675f7ac64fe,subnet-0f9a22c87e766fa17
vpcId: vpc-016f35c7f078ab9e8

> Remove one of the subnets
delete aws:ec2/subnet:Subnet private-subnet-3-3 ...
deleted private-subnet-3-3
privateSubnetIds: subnet-08add1c8ae97e3cfb,subnet-0cb4ea675f7ac64fe
vpcId: vpc-016f35c7f078ab9e8

>
```

```
Welcome to Pulumi AI.

Your stack: https://app.pulumi.com/luke-pulumi-corp/pulumi-ai/dev/resources

What cloud infrastructure do you want to build today?

> an s3 bucket
create aws:s3/bucket:Bucket my-bucket ...
created my-bucket
Stack Outputs:
  bucketName: my-bucket-cc63555

> add an index.html file that says "Hello, world!" in three languages
update aws:s3/bucket:Bucket my-bucket ...
updated my-bucket
create aws:s3/bucketObject:BucketObject index ...
created index
Stack Outputs:
  bucketName: my-bucket-cc63555

> give me a url for that index.html file
update aws:s3/bucket:Bucket my-bucket ...
updated my-bucket
create aws:s3/bucketPolicy:BucketPolicy bucketPolicy ...
created bucketPolicy
Stack Outputs:
  bucketName: my-bucket-cc63555
  indexUrl: http://undefined/index.html

> That gave an undefined url.  Can you fix it?
update aws:s3/bucket:Bucket my-bucket ...
updated my-bucket
Stack Outputs:
  bucketName: my-bucket-cc63555
  indexUrl: http://my-bucket-cc63555.s3-website-us-west-2.amazonaws.com/index.html

> Great - that worked!  Now make it fancier, and add some color :-)
update aws:s3/bucket:Bucket my-bucket ...
updated my-bucket
update aws:s3/bucketObject:BucketObject index ...
updated index
Stack Outputs:
  bucketName: my-bucket-cc63555
  indexUrl: http://my-bucket-cc63555.s3-website-us-west-2.amazonaws.com/index.html

> !program
<snip>

> !quit
```