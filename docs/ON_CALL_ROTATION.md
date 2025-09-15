# On-Call Rotation Procedures

## Overview
This document outlines the on-call rotation schedule, responsibilities, and procedures for maintaining 24/7 coverage of the mgmt-vibe platform.

## On-Call Roles

### Primary On-Call Engineer
- **Responsibility**: First responder to all production incidents and alerts
- **Response Time**: 15 minutes for critical alerts, 30 minutes for non-critical
- **Availability**: Must be reachable 24/7 during rotation
- **Handover**: Brief incoming engineer on current system status

### Secondary On-Call Engineer
- **Responsibility**: Backup support for primary engineer
- **Response Time**: 30 minutes for critical alerts
- **Availability**: Must be reachable during business hours, best effort after hours
- **Escalation**: Automatically notified if primary doesn't respond

### Engineering Manager
- **Responsibility**: Oversight and escalation path for complex incidents
- **Response Time**: 1 hour for critical incidents
- **Availability**: Business hours with emergency contact after hours

## Rotation Schedule

### Weekly Rotation
- **Duration**: 1 week per engineer
- **Handover**: Every Monday at 9:00 AM PST
- **Holidays**: Rotations skip holidays; coverage transferred to previous engineer

### Current Schedule (Week of [Date])
| Week Starting | Primary Engineer | Secondary Engineer | Manager |
|---------------|------------------|-------------------|---------|
| [Date] | [Engineer 1] | [Engineer 2] | [Manager] |
| [Date] | [Engineer 2] | [Engineer 1] | [Manager] |
| [Date] | [Engineer 3] | [Engineer 1] | [Manager] |
| [Date] | [Engineer 1] | [Engineer 3] | [Manager] |

### Holiday Coverage
- **Notification**: Engineers must notify team 2 weeks in advance of planned absences
- **Coverage**: Previous week's engineer covers unless otherwise arranged
- **Documentation**: Update shared calendar with coverage changes

## On-Call Responsibilities

### Daily Duties
1. **Morning Check-in** (9:00 AM PST)
   - Review overnight alerts and incidents
   - Check system health dashboards
   - Verify backup completion
   - Review pending security updates

2. **System Monitoring**
   - Monitor alerting systems for new issues
   - Review error rates and performance metrics
   - Check database replication status
   - Verify backup integrity

3. **Incident Response**
   - Acknowledge alerts within response time
   - Assess incident severity and impact
   - Follow incident response runbook
   - Escalate as needed per procedures

### Emergency Contacts
- **Primary**: [Phone number] - Available 24/7
- **Secondary**: [Phone number] - Business hours
- **Manager**: [Phone number] - Emergency contact
- **Infrastructure Provider**: [Support contact] - For hosting issues

## Communication Protocols

### Alert Response
1. **Acknowledge** alert within response time
2. **Assess** situation and determine severity
3. **Investigate** using monitoring tools and logs
4. **Communicate** status to stakeholders
5. **Resolve** or escalate as appropriate

### Internal Communication
- **Primary Channel**: #incidents Slack channel
- **Updates**: Post status updates every 30 minutes during active incidents
- **Escalation**: Use @here for urgent situations, @channel for critical

### External Communication
- **Status Page**: Update https://status.mgmt-vibe.com
- **Customer Notifications**: For SEV-0/SEV-1 incidents
- **Social Media**: Post updates for widespread outages

## Tools and Access

### Required Access
- **PagerDuty**: Alert management and escalation
- **Monitoring Dashboards**: Grafana, Prometheus, DataDog
- **Incident Management**: Jira Service Desk, Zendesk
- **Infrastructure**: AWS Console, Kubernetes dashboard
- **Database**: PostgreSQL access, monitoring tools
- **Communication**: Slack, email, phone

### Development Environment
- **Staging Access**: Full access to staging environment
- **Testing Tools**: Ability to deploy to staging for validation
- **Documentation**: Access to runbooks and procedures

## Handover Procedures

### Weekly Handover Meeting
**Time**: Every Monday at 9:00 AM PST
**Duration**: 30 minutes
**Attendees**: Incoming on-call, outgoing on-call, engineering manager

#### Handover Checklist
- [ ] Review current system status and any open incidents
- [ ] Transfer knowledge of ongoing issues or scheduled maintenance
- [ ] Confirm contact information and availability
- [ ] Review any upcoming deployments or changes
- [ ] Document any known issues or areas of concern
- [ ] Confirm monitoring alerts are properly configured

### Emergency Handover
If immediate handover is required:
1. **Notify** incoming engineer via all available channels
2. **Transfer** critical information verbally
3. **Document** handover in incident ticket
4. **Confirm** incoming engineer has required access

## Training and Certification

### On-Call Training Requirements
- [ ] Complete incident response runbook training
- [ ] Shadow experienced on-call engineer for one rotation
- [ ] Pass hands-on incident simulation exercises
- [ ] Demonstrate familiarity with all monitoring tools
- [ ] Complete infrastructure access training

### Certification Checklist
- [ ] Can access all required systems and tools
- [ ] Knows escalation procedures and contact information
- [ ] Familiar with incident response runbook
- [ ] Understands monitoring dashboards and alerts
- [ ] Has practiced incident response scenarios

## Performance Expectations

### Response Time Metrics
- **SEV-0 (Critical)**: 15-minute acknowledgment, 1-hour resolution target
- **SEV-1 (High)**: 30-minute acknowledgment, 4-hour resolution target
- **SEV-2 (Medium)**: 1-hour acknowledgment, 8-hour resolution target
- **SEV-3 (Low)**: 4-hour acknowledgment, 24-hour resolution target

### Quality Metrics
- **False Positive Rate**: < 5% of alerts should be false positives
- **Mean Time to Resolution**: Track and improve over time
- **Customer Impact**: Minimize downtime and service degradation
- **Post-Incident Reviews**: Complete within 48 hours

## Compensation and Support

### On-Call Compensation
- **Base Rate**: [Compensation details]
- **Overtime**: [Overtime policies]
- **Emergency Call-outs**: [Emergency response compensation]

### Support Resources
- **Mental Health**: Access to counseling services for on-call stress
- **Technical Support**: 24/7 access to senior engineers
- **Automation Tools**: Invest in tools to reduce on-call burden
- **Process Improvement**: Regular reviews to optimize on-call experience

## Emergency Procedures

### Unable to Respond
If primary on-call engineer cannot respond:
1. **Automatic escalation** to secondary engineer after 15 minutes
2. **Manager notification** after 30 minutes
3. **Emergency contacts** activated after 1 hour
4. **Backup engineer** assumes primary responsibilities

### System-Wide Emergency
For company-wide emergencies:
1. **Follow company emergency procedures**
2. **Prioritize customer safety and communication**
3. **Coordinate with other teams and departments**
4. **Maintain service continuity as much as possible**

## Continuous Improvement

### Monthly Reviews
- **Incident Analysis**: Review all incidents for patterns and improvements
- **Process Updates**: Update runbooks based on lessons learned
- **Tool Improvements**: Identify and implement better monitoring/alerting
- **Training Updates**: Refresh training materials and procedures

### Feedback Collection
- **Anonymous Surveys**: Collect feedback on on-call experience
- **Retrospective Meetings**: Discuss what worked and what didn't
- **Suggestion Box**: Allow engineers to propose improvements
- **Industry Benchmarks**: Compare against industry standards

## Contact Information

### Current On-Call Engineers
- **Primary**: [Name] - [Phone] - [Email]
- **Secondary**: [Name] - [Phone] - [Email]
- **Manager**: [Name] - [Phone] - [Email]

### External Contacts
- **Infrastructure Support**: [Provider] - [Phone] - [Hours]
- **Security Team**: [Team] - [Phone] - [Email]
- **Legal/Compliance**: [Team] - [Phone] - [Email]

---

**Last Updated**: [Date]
**Document Owner**: [Engineering Manager]
**Review Frequency**: Monthly
