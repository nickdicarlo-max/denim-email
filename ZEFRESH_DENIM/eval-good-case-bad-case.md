This document captures how to determine if a case is good or bad

GOOD CASE
> topic coherence, e.g. all the emails in the case with a soccer practice title are about soccer practice. All the emails in a case about a rental property the user owns at 1205 Summit are about the property 1205 Summit.
> The title accurately describes the case, and the case is about a topic the user would care about having organized on their behalf.
> case is logical by time, meaning it is talking about events that will happen in the  future that require action, not the past.  Another logical by time attribute is there are not large time gaps between events, e.g. a topic likely has  cadence of email arrival, and if there is a big gap in time, that liekly means its a different topic
> a case shows a real action that needs to be taken, not showing things that are not actions and causing stress by showing more than is needed.  Showing the wrong action increases cognitive load and stress.  Only the key things needed to solve the users problem
> the content in a case is date aware.  We may scan the email on a date, but that date will pass 1 week later, so the case should age out of relevance automatically (by code, not by AI)
> past cases shown at the bottom of a case feed are OK, they are confidence signals and memory joggers about the past.
> cases should be sorted by order of actionabilty and time proximity.  Out of sequence by date is confusing to the user.


BAD CASE
> case mixes practices, games, and other information together, so it isn't clear what the case is about
> A case is placed in the wrong topic category / primary category because of the order by which emails were read, not by logic of what the case is about.
> case includes emails from newsletters, marketing inboxes, or unrelated topics because they match a keyword
> case includes senders who aren't relevant to the topic
> items from other schema should not appear in an onboarding scan

BAD CASE CREATION / EXCLUSION
> if an email is scanned and is about a case related topic, but not included in a case, this is a failure, since the user will never see an email that was excluded.