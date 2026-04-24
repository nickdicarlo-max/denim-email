This is the evaluation rubric for a good onboarding

TEST ONBOARDING
Using /denim_samples_individual, run each of 3 nick schema against the inbox to validate the domain discovery and entity discovery before testing on live gmail account, or doing further gmail synthesis.

Preserve the synthesis of the denim_samples_individual once completed for re-use
SCHEMA ONE: school_parent
>> primary: soccer, dance, lanier, stagnes, st agnes, guitar
>> secondary: ziad allan, grouped with soccer
>> stress test: add amy dicarlo, grouped with lanier, stagnes, st agnes
>> does the domain discovery uncover team snap
>> does the entity discovery find soccer, dance, lanier, stagnes and propose also "martial arts" or "belt test"


SCHEMA TWO: property.md
>> primary: 851 Peavy, 3910 Bucknell, 2310 Healey
>> secondary: Timothy Bishop, Vivek Gupta, Krystin Jernigan
>> This should automatically discover 9 to 12 properties, and many other @judgefite.com senders

SCHEMA THREE: consulting / agency
>> primary: portfolio pro advisors, stallion
>> secondary: margaret potter, george trevino, farrukh
>> this should discover emails from all three, and both entites.

ONLY AFTER SUCCESSFULLY doing entity discovery on the test data, let's use claude and gemini to run the pipeline and scan and sythesize these emails. We should preserve the gmail synthesis so we don't waste tokens doing the same thing over and over again.


NEW USER ONLY
1. landing page for the site clearly explains our value in manner that resonates with the uesr, helps them fmeel that someone finally understands their personal frustration with their email inbox, while fully respecting their intelligence, and endeveavors to solve their problem quietly.  Follows skill /nick-voice
2. User decides to try the service, and the onboarding interview is simple and clear, guiding them to enter right "hints" that allows case creation to happen.
3. Once the hints are entered, gmail OAuth signs the user in and we do as close to an instantaneous discovery as possible. We use creative ideas such as searching entered people for their email address, discovering their domain, using that domain to discover both the people who are involved in the topic AND the types of cases that could be created
4. Our super fast discovery successfully identifies the types of cases that the user would want, based on their interview.  Interviews are guided by the files stored in 'docs/domain-input-shapes/;  including @Schoo_parent.md for example, so we know the user is itrying to organize schoo and kids activities, so our search should turn up those things and ignore irrelevant topics.
5. a user who sees their inbox well represented will then allow us the time to synthesize 200+ emails to create cases.  if those cases are good quality per @eval-good-case-basecase.md, then they will be satisfied with the product.
6. if they are satisfied with the product, they will ask us to organize another topic, a different onboarding interview question set, documented in /docs/domain-input-shapes/*filename*.  Onboarding 2 to 6 topis is success.
At this point we will start a daily chron job to syn their emails and update their cases daily, plus whenever they log in
7. after 7 to 30 days, they will be askekd to subscribe.  If they find utility via good cases they will subscribe
8. # of emails matching a case will vary by case and the # of emails the person receives.  Most cases should NOT be 1 email, but be a sequence of emails.  80% of cases or more should be higher than 1 email cases.
9.  SLA for onboarding: ≤5s domain scan / ≤6s entity discovery / ≤5min for full case creatino for 1 topic, as pass/fail.

RETURNING USER
1. Both immediately after onboarding their first topic, and every day after, the user who returns to the site will be greeted by their case feed wtih no additional clicks.  Seeing their latest cases is critical to satisfaction as they will be getting value from the product if the next task they need to do is clearly presented, their emails are synced and fully up to date.
2. Due to the onboarding of single emails, we may face a higher risk of single emails being excluded from cases. THis is a good thing to report to the developer